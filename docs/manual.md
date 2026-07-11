# thalk — Operator's Manual

Practical, copy-pasteable steps for running thalk day to day. For *why* things
are shaped this way, see [thalk.design.md](thalk.design.md) and
[thalk.i18n.md](thalk.i18n.md).

- **Site**: static, built by `site/build.mjs`, hosted on GitHub Pages, auto-deployed on push to `main`.
- **Backend**: Firebase project `thalk-1c092` (region `asia-east1`) — form endpoints + newsletter, deployed manually.
- **Prerequisites**: Node 22, `python3` (for local serve), and — only for backend/newsletter work — the `firebase` and `gcloud` CLIs authenticated as a project owner.

---

## 1. Serve locally

Build (including drafts) and serve on <http://localhost:4173>:

```sh
npm run serve
```

This runs `site/build.mjs --drafts` then `python3 -m http.server 4173 -d dist`.
It is a **one-shot build** — it does not watch for changes. After editing
content, templates, or CSS, stop it (Ctrl-C) and re-run, or in another terminal:

```sh
npm run build:drafts   # rebuild dist/ in place; refresh the browser
```

There is no unprefixed home page: `/` is a redirector. Open
<http://localhost:4173/en/> or <http://localhost:4173/zh/> directly.

---

## 2. Build

```sh
npm run build          # runs the i18n gate, then builds → dist/  (production: no drafts)
npm run build:drafts   # build including draft posts, skip the gate
npm run check          # run the i18n coverage gate on its own
```

`npm run build` first runs `scripts/check-i18n.mjs`, which **fails (exit 1)** if
any translation group is missing a required language (`en` + `zh`) and isn't
marked `solo: true`. This is the same gate CI runs — if it fails locally, the
deploy would fail too. Fix by adding the missing language version or marking the
post single-language (see §3).

---

## 3. Publish a post

Publishing is: **write markdown → commit → push to `main`.** GitHub Actions
(`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages; the live
site updates in a minute or two. There is no web editor and no manual deploy
step for the site.

### Where posts live

```
site/content/
├── en/posts/<slug>.md      # English version
└── zh/posts/<slug>.md      # 繁體中文 version
```

Pages (About, Support) are `site/content/<lang>/about.md`, `support.md`.

### Front matter

```yaml
---
key: my-post-slug        # ties the language versions together; also the URL slug
lang: en                 # must match the folder it's in
title: "My post title"
date: 2026-07-11
description: "One-line summary for lists, RSS, and email."
draft: false             # true = builds locally, never deploys
tags: [thinking]
syndicate: []            # [email] to send this version as a newsletter (see §5)
provenance: original     # original | machine | reviewed  (see thalk.i18n.md)
---
```

The **`key` is shared** across languages; the same post in EN and ZH uses the
same `key` and therefore the same slug (`/en/posts/my-post-slug/`,
`/zh/posts/my-post-slug/`).

### The i18n rule (important)

Every post is expected to exist in **both `en` and `zh`**. If you publish only
one language, the build gate fails. Two ways forward:

- Write both language versions, then commit.
- Mark the post as **intentionally single-language**: add `solo: true` to the
  one version's front matter. The gate then passes for that post.

thalk does **not** machine-translate for you — AI translation is a separate
agent's job. Before pushing, decide per post whether the missing language is
coming or the post is `solo`.

### Draft workflow

`draft: true` posts live safely on `main` — they build locally with
`--drafts` but are excluded from production. Flip to `false` (or remove it) and
push when ready.

---

## 4. Deploy the backend (functions)

Only needed when `functions/index.js`, `firestore.rules`, or function secrets
change — **not** for normal writing/publishing. Requires an interactive login
first (tokens expire; run these yourself in your terminal):

```sh
gcloud auth login          # interactive — refreshes gcloud + ADC
firebase login             # if the firebase CLI token has expired
```

Then deploy:

```sh
firebase deploy --only functions --project thalk-1c092
firebase deploy --only firestore --project thalk-1c092    # only if rules/indexes changed
```

### Gotchas (all have bitten this project before)

- **New functions default to private.** A non-interactive `firebase deploy`
  does *not* prompt to allow unauthenticated access, so a newly created public
  function returns 403 until you bind the invoker. Grant it explicitly:

  ```sh
  gcloud functions add-invoker-policy-binding <fn> \
    --region asia-east1 --member=allUsers --project thalk-1c092
  ```

  Public functions: `subscribe`, `supportLead`, `unsubscribe`, `setLanguage`.
  **Do not** grant `allUsers` to `newsletterRecipients` / `newsletterMarkSent`
  — those are locked to the `thalk-newsletter-invoker` service account on
  purpose (they can return the whole subscriber list). Verify the real binding
  after any deploy — Firebase can silently re-add `allUsers`:

  ```sh
  gcloud run services get-iam-policy newsletterrecipients \
    --region asia-east1 --project thalk-1c092    # should list ONLY the SA
  ```

- **Secrets** live in Google Secret Manager, bound at deploy via
  `defineSecret`. To rotate one:

  ```sh
  printf '%s' "<value>" | firebase functions:secrets:set <NAME> --project thalk-1c092 --force
  firebase deploy --only functions --project thalk-1c092    # redeploy to pick it up
  ```

  Names in use: `THALK_LINK_SECRET` (per-email unsubscribe/language tokens),
  `THALK_ADMIN_SECRET` (gates the two newsletter functions).

- If a deploy half-fails leaving a function in `UNKNOWN`/`FAILED`, delete it
  (`gcloud functions delete <fn> --region asia-east1`) and redeploy clean.

---

## 5. Send a newsletter

Sending is a **two-phase, plan-then-send** flow. A post marked `syndicate:
[email]` is a *candidate*, not an auto-send. What has (and hasn't) been sent
lives in a git-committed ledger, `newsletter/sent.jsonl` — not Firestore — so
losing Firestore state can never cause a re-send. See
`docs/thalk.publish.send.revisit.md` for the design.

### What makes a post a candidate

A non-draft post version is a **candidate** if its front matter has `syndicate:
[email]` **and** its current body hash has no line in `newsletter/sent.jsonl`
(any status). So: publishing a new such post makes it a candidate; sending or
skipping it retires it; editing its body later (new hash) makes it a candidate
again.

### Normal path (GitHub, mobile-friendly)

1. Publish a post with `syndicate: [email]` and push. The **plan** job in
   `.github/workflows/newsletter.yml` opens a GitHub Issue labelled
   `newsletter-plan` — "Newsletter plan for `<sha>`" — with a checkbox per
   candidate and the per-post / total / max-per-subscriber email counts.
2. On your phone or desktop, **uncheck** any post you want to publish but not
   email, then comment:
   - `/send` — email the checked posts, record the unchecked as `skipped`;
   - `/skip` — record every candidate as `skipped`, send nothing.
3. The **send** job runs — gated to you (owner-only actor check + the
   `newsletter-plan` label + an Environment approval) — sends, appends decisions
   to `newsletter/sent.jsonl`, commits it, comments the result, and closes the
   issue.

Only the repo owner can trigger a send (owner-only actor check + Environment
approval; see the Authorization section of
`docs/thalk.publish.send.revisit.md`). De-selecting a post doesn't un-publish
it — the site already deployed on push.

### Manual / local

Needs `THALK_ADMIN_SECRET`, `THALK_LINK_SECRET`, `RESEND_API_KEY`, and
`GOOGLE_APPLICATION_CREDENTIALS` pointing at a `thalk-newsletter-invoker`
service-account key (the scripts authenticate as that SA to reach the
IAM-restricted `newsletterRecipients`).

```sh
npm run newsletter:plan                          # list pending candidates + email counts
npm run newsletter:dry                           # preview send/skip split, offline, no counts
node scripts/send-newsletter.mjs --all           # send every pending candidate
node scripts/send-newsletter.mjs --select=post:<slug>:<lang>,...   # send these, skip the rest
node scripts/send-newsletter.mjs --skip-all      # record all pending as skipped
```

The scripts print **counts only, never addresses**. `send-newsletter.mjs`
appends to `newsletter/sent.jsonl` but does **not** commit — after a local send,
`git add newsletter/sent.jsonl && git commit`. Send-from address is
`news@thalk.chuboyu.space`; change it in `site/config.mjs` (`newsletterFrom`).

### Recovering from Firestore loss (a non-event)

If `newsletter_sends` or all of Firestore is lost, the ledger is untouched, so
the next plan is unchanged — no back-catalogue blast. Restore `subscribers` from
your backup (§6) and carry on. (There is no `newsletter_sends` collection
anymore; the ledger replaced it.)

---

## 6. Export / back up subscribers

The subscriber and lead lists are the one dataset outside git. Dump them to
JSON (needs `gcloud auth application-default login` first):

```sh
node scripts/export-subscribers.mjs > backup.json
```

Produces `{ subscribers: [...], support_leads: [...] }`. Run it on a schedule
if you want off-Firestore backups.

---

## Quick reference

| Task | Command |
|---|---|
| Preview locally | `npm run serve` → <http://localhost:4173/en/> |
| Rebuild (drafts) | `npm run build:drafts` |
| Production build + gate | `npm run build` |
| i18n coverage check | `npm run check` |
| Publish a post | commit + `git push` to `main` |
| Deploy functions | `firebase deploy --only functions --project thalk-1c092` |
| List newsletter candidates | `npm run newsletter:plan` |
| Preview send/skip split | `npm run newsletter:dry` |
| Send newsletter | mark a post `syndicate: [email]`, push, then `/send` on the plan issue |
| Back up subscribers | `node scripts/export-subscribers.mjs > backup.json` |
