# thalk — publish / send split (revisit)

Status: **proposal, not yet built.** Supersedes the earlier "circuit-breaker"
guard idea. Records send-state in a git-committed ledger (not Firestore, not a
git-diff against a baseline commit) so the anti-spam property is structural and
survives a Firestore wipe.

## Why revisit

Today the newsletter send set is "every `syndicate: [email]` post whose content
hash isn't already recorded in the Firestore `newsletter_sends` collection." That
gate is **fail-open**: if `newsletter_sends` is lost while `subscribers` survive
(accidental collection delete, a migration, or a wipe followed by restoring
subscribers from the `scripts/export-subscribers.mjs` backup — which doesn't cover
`newsletter_sends`), the next run treats the whole archive as unsent and mails all
of it.

The fix: keep the record of what's been sent **in the repo**, where it's durable,
versioned, and wipe-proof. Git is already the content source of truth; the
send-decision log belongs next to it.

Also wanted:
- a reviewable **plan** — which posts, and how many emails per subscriber and in
  total, *before* anything is sent;
- per-post **de-selection** — skip the email for a post while still publishing it
  to the site, *without* that post nagging in every future plan;
- a separate **send** step, operable from GitHub (including mobile) and **guarded**
  so only the owner can trigger it.

## Model

- **Site publishing stays automatic** on push (`.github/workflows/deploy.yml`
  unchanged). A post always reaches the site regardless of any newsletter
  decision.
- `syndicate: [email]` marks a post as a **candidate** for the newsletter, not an
  instruction to auto-send.
- The newsletter is **two phases**:
  - **Plan** — list candidate posts and their counts; the owner selects /
    de-selects; emit a pinned plan.
  - **Send** — email only the selected posts, then append to the ledger.

## The send ledger (replaces both Firestore state and git-diffing)

A single append-only file committed to the repo, e.g. `newsletter/sent.jsonl`, one
line per decision:

```json
{"key":"hello-thalk","lang":"en","hash":"sha256:1a2b…","status":"sent","at":"2026-07-11T09:00:00Z","recipients":42}
{"key":"draft-notes","lang":"zh","hash":"sha256:9f8e…","status":"skipped","at":"2026-07-11T09:00:00Z"}
```

- **Hash** is the post body hash from the existing `hashBody()` in
  `site/util.mjs` — the same function already used for translation staleness and
  the current `newsletter_sends`, so "have we decided on this exact content?" is
  the same notion of identity used elsewhere.
- **Candidate** = a non-draft `syndicate: [email]` post-version whose *current*
  body hash has **no matching ledger line of any status**. Therefore:
  - never-decided version → candidate;
  - `sent` or `skipped` at this exact content → not a candidate (no nagging — this
    is what fixes de-selection);
  - edited after a decision (new hash) → candidate again (resend-on-change still
    works).
- The plan phase reads the working tree + the ledger. **No baseline commit, no
  `git diff`, no dependence on commit topology** (rebases, squashes, and
  force-pushes don't affect it).
- The send phase appends a `sent` (or `skipped`) line for every candidate it
  processed and commits `newsletter/sent.jsonl` back to `main`.
- The ledger is a durable, wipe-proof **audit log** for free (its git history is
  the send history).
- **Loop safety:** after the ledger commit, those versions all have decisions →
  the next plan run finds no candidates → no issue, no loop. Add
  `paths-ignore: ['newsletter/**']` to the plan and deploy triggers so a
  ledger-only commit doesn't needlessly re-run them.

### Firestore after this change

- `newsletter_sends` collection and the `newsletterMarkSent` function become
  **redundant and are removed** — send-state now lives in the ledger.
- `newsletterRecipients` **stays but simplifies**: it no longer does the
  already-sent/hash check; it just returns the recipient list (or a count) for a
  language, still behind the admin-secret + service-account gate. `subscribers`
  remains the only Firestore data the flow touches.

## Plan phase (reviewable, de-selectable, owner-operable)

New `scripts/newsletter-plan.mjs` computes, from the working tree + ledger:

- the candidate posts,
- per-post recipient counts (via `newsletterRecipients`, `countOnly` mode),
- total emails, and
- **max emails a single subscriber receives** in this run (= number of selected
  posts in their language — the "am I about to hit one person with five emails at
  once" signal).

It emits a human summary to the Actions **step summary** and a machine artifact
pinning `{ candidates: [{ key, lang, hash, title, recipientCount }] }`.

**Review + de-selection UX** (GitHub-native, mobile-friendly): the plan job opens
or updates a labelled GitHub **Issue** — "Newsletter plan for `<short-sha>`" — with
a task-list checkbox per candidate (checked = will send), counts inline, and
instructions: *uncheck a post to skip it, comment `/send` to dispatch or `/skip` to
record skips and close*. Task-list checkboxes toggle from the GitHub mobile app;
the comment triggers the send workflow.

De-selecting a post: it still reached the site; it's recorded `skipped` in the
ledger on `/send` (or via `/skip`), so it won't reappear as a candidate unless it
changes again.

## Send phase

- Triggered by a `/send` (or `/skip`) comment on the plan issue.
- Reads the pinned plan + the checkbox selection. For each **checked** candidate it
  sends to that language's recipients (reusing `newsletterEmail()` in
  `site/templates.mjs`, the Resend call, and the per-email unsubscribe/setLanguage
  tokens); each **unchecked** candidate is recorded `skipped`.
- Appends all decisions to `newsletter/sent.jsonl` and commits (paths-ignored so it
  doesn't re-trigger plan/deploy). Comments results back and closes the issue.
- **At-least-once caveat:** commit a ledger line per post right after that post's
  send completes, so a mid-batch crash can at most resend the one post in flight,
  not the whole batch. Acceptable for this scale.

## Authorization — who can `/send`

The repo is **public**, and this is built to public standard regardless of
visibility. `issue_comment` fires for anyone with a GitHub account who can comment,
and the triggered job runs with the repo's secrets — so an unguarded `/send` would
let a stranger trigger a send. Guards, applied together:

1. **Actor check (required).** The send job runs only if the commenter is the
   owner. `author_association` is set by GitHub from the commenter's real
   relationship to the repo and cannot be spoofed by the payload:

   ```yaml
   if: >
     github.event.issue.pull_request == null &&
     github.event.comment.author_association == 'OWNER' &&
     contains(github.event.issue.labels.*.name, 'newsletter-plan')
   ```

   (Swap `author_association == 'OWNER'` for an explicit login allowlist if
   collaborators are added.) Non-owner comments, and `/send` on any issue lacking
   the `newsletter-plan` label, are ignored.
2. **Environment approval (recommended second gate).** Put the send job in a
   GitHub **Environment with required reviewers** (you). Even a valid trigger then
   pauses for a one-tap mobile approval — this is also the mobile-approval seam.
3. **Least privilege + no injection.** Set the workflow's `permissions:` to the
   minimum the jobs need (`issues: write` for the plan/issue, `contents: write`
   only on the ledger-commit step) rather than the default broad token. And treat
   all event text as untrusted: **never interpolate `github.event.comment.body`,
   the issue body, or checkbox text into a `run:` shell** (a classic public-repo
   command-injection vector). Pass such values through `env:` and parse them inside
   the Node script, so a crafted comment can't inject commands even from an
   ignored, non-owner event.

## Files

| File | Change |
|---|---|
| `newsletter/sent.jsonl` | **new** — the committed send/skip ledger |
| `scripts/newsletter-plan.mjs` | **new** — candidates from tree + ledger → counts → open/update the plan issue |
| `scripts/send-newsletter.mjs` | take a **pinned plan + selection**; drop the scan/hash-gate logic (`:96-118`); append to the ledger + commit instead of calling `newsletterMarkSent` |
| `functions/index.js` | remove `newsletterMarkSent` + `newsletter_sends`; simplify `newsletterRecipients` (`:197`) to a recipients/`countOnly` query |
| `.github/workflows/newsletter.yml` | split into a **plan** job (push to main, `paths-ignore: ['newsletter/**']`) and a **send** job (`issue_comment` `/send`, actor-checked, environment-gated) |
| `docs/manual.md` §5 | rewrite around plan → review/de-select → send; ledger + authorization notes |

## Edge cases

- **First adoption / many candidates at once** → large plan → de-select down or
  approve deliberately. The plan review is the gate; no magic threshold.
- **Re-comment `/send` on an already-processed plan** → those hashes are in the
  ledger → no candidates → no duplicate emails.
- **Post edited after being sent** → new hash → reappears as a candidate; you
  choose resend or skip.
- **Ledger merge conflicts** → append-only JSONL rarely conflicts; if two sends
  ever overlap, resolve by keeping both lines.
- **Manual send** → a `workflow_dispatch` variant (inherently limited to users with
  write access) can run the same plan/send against the current tree.

## Verification (when built)

1. CSS-only push → plan empty → no issue, nothing sent.
2. New `syndicate: [email]` post pushed → plan lists it (en + zh) with correct
   per-post / total / max-per-subscriber counts → issue opened → owner comments
   `/send` → emails go, ledger lines appended + committed.
3. Simulate a `newsletter_sends`/Firestore wipe → the ledger is unaffected → next
   push’s plan is unchanged → **no archive blast** (the core fix).
4. De-select one post in the issue → `/send` → it isn't emailed, is recorded
   `skipped`, doesn't reappear in later plans, and is still live on the site.
5. Non-owner comments `/send` → job is skipped (actor check).

## Non-goals

- No custom mobile UI — GitHub issues / environments are the operable surface.
- No change to site publishing (`deploy.yml`) or to the token / secret / IAM model
  beyond removing the now-unused `newsletterMarkSent`.
