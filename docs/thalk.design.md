# thalk — Design

**thalk** is a personal publishing channel at `https://thalk.chuboyu.space`: a bilingual (English + Traditional Chinese) blog written in markdown, published by me (usually through a coding agent), readable by everyone, subscribable by email, with a support page that captures funding intent, and — over time — automated syndication to social networks.

This is the single design document for the project. It covers the static site, the bilingual/i18n model, the Firebase form/newsletter backend, and the git-ledger-based newsletter plan/send flow.

## Principles

1. **Static first.** Everything that can be a static file is a static file. Dynamic behavior is limited to a few tiny endpoints (subscribe, support lead, unsubscribe, set-language, and the admin-gated recipient lookup).
2. **Markdown in, everything out.** The git repo is the single source of truth — for content *and* for who-has-been-emailed. A post is a `.md` file with front matter; publishing is `git push`.
3. **Ejectable at every layer.** No component may hold data or behavior that can't be replaced in an afternoon. Content is plain markdown in git, the site builds to plain HTML with one command, subscriber data is exportable as JSON/CSV, and every third-party service has a named replacement (see the eject table).
4. **Transparency is a feature.** When a page is machine-translated or AI-written, the reader is told plainly. The repo is public and these signals are committed markdown.
5. **Don't overkill.** No CMS, no database for content, no auth system, no comment system. Features arrive in phases only when the previous phase is actually in use.

## Architecture at a glance

```
 write .md ──► git push ──► GitHub Actions ─┬─► deploy.yml ──► build (own script) ──► GitHub Pages
                                            │                                         thalk.chuboyu.space
                                            └─► newsletter.yml (plan) ──► opens a review Issue
                                                       ▲                         │
                                            /send or /skip comment (owner)       │ subscribe / support (fetch)
                                                       │                         ▼
                                            newsletter.yml (send) ──► Resend    Firebase Cloud Functions
                                                       │                         │  (Cloud Run, 2nd gen)
                                                       ▼                         ▼
                                          newsletter/sent.jsonl (git)   Firestore: subscribers, support_leads
```

Two halves, deliberately decoupled:

- **The site** — static, built from markdown, hosted on GitHub Pages. Zero runtime dependencies; if every dynamic service dies, the blog stays up.
- **The services** — a single small Firebase Functions codebase handling form submissions and subscriber lookups, writing to Firestore. The site calls it with plain `fetch`; if it's down, only the forms degrade.

Send-state (who has been emailed which post) lives in git, not Firestore — see §5.

## Components

### 1. Content & the bilingual model

Posts live under `site/content/<lang>/posts/*.md`; pages (About, Support) under `site/content/<lang>/`. Front matter:

```yaml
---
key: thinking-out-loud     # ties language versions together; also the URL slug
lang: en
title: "On thinking out loud"
date: 2026-07-08
description: "One-line summary used in lists, RSS, and social posts."
draft: false               # drafts build locally, never deploy
tags: [thinking]
syndicate: []              # [email] marks the post a newsletter candidate (see §5)
provenance: original       # original | machine | reviewed  (translation axis)
authorship: human          # human (default) | ai-assisted | ai-generated
# solo: true               # opt out of the both-languages requirement (see below)
# machine/reviewed versions also carry: base, model, translatedAt, baseHash
---
```

**Translation groups, not "post + translations."** Standard i18n treats one canonical text with N translations. That's wrong here: English and Chinese are both first-class, and a piece may be *re-authored* for each audience rather than translated. So the model is a **translation group** — one `key`, several language *versions*, each with its own `provenance`:

- **`original`** — written by a human. A group can have several originals (EN and ZH both); none is subordinate. When both are `original`, the cross-language link reads "also written in 中文 (a separate version)", not "translation".
- **`machine`** — produced by AI from a designated `base` version.
- **`reviewed`** — an AI draft then edited by a human.

Slugs follow the `key` in every language (`/en/thinking-out-loud/`, `/zh/thinking-out-loud/`) — no per-language slug overrides. thalk itself does **not** perform AI translation; a separate agent owns that and writes `machine`/`reviewed` files into the well-defined slot this model provides.

**Authorship is a separate axis from provenance.** `provenance` is about *translation from a base*; `authorship` is about *how the content itself was produced*. An AI-written original has no base (so it's `provenance: original`) but should still disclose AI involvement — that's `authorship: ai-assisted | ai-generated` (default `human`). The two compose: a post can be both an AI translation *and* AI-assisted in its source.

**Pre-publish coverage gate.** The baseline expectation is that every group has both `en` and `zh`. `scripts/check-i18n.mjs` (run in CI and locally before publish) fails loudly if a group is missing a required language, so nothing ships half-translated by accident. To publish an intentional single-language piece, mark the version `solo: true` — the act of adding it *is* the approval, recorded in git.

Content updates come only from commits to `main` — by me or via a coding agent opening changes I approve. There is no web editor and no admin panel; git history *is* the audit log.

### 2. Site build — our own script, no SSG

No Astro, Hugo, or Eleventy. The "static site generator" is a single script (`site/build.mjs`) because the job is small and fixed:

1. Read every `.md` under `site/content/<lang>/`, parse front matter, skip `draft: true`.
2. Group files by `key`; compute sibling links, provenance, and hreflang for each version.
3. Render markdown to HTML through template-literal functions (no template language) and emit `dist/`: per-language post pages, per-language index (listing only posts present in that language), per-language `rss.xml`, the About/Support pages, the root language detector, and a copy of `site/static/`.

Only two library dependencies, because a correct markdown parser is the one part that *would* be overkill to hand-roll: **`marked`** (markdown → HTML) and **`gray-matter`** (front matter). Both are small and vendorable. RSS is hand-built (~30 lines; the only subtlety is XML-escaping).

The build also renders the reader-facing transparency layer:

- **Provenance banner.** Every non-`original` page carries a banner ("🤖 AI translation from the English original, by `<model>` on `<date>` · read the original · report an error"). `reviewed` softens the wording; `original` shows no banner.
- **Staleness.** A `baseHash` on each `machine`/`reviewed` version records the base body at translation time; the build recomputes it and, on mismatch, shows "the original has changed since this translation" and prints a build warning.
- **Tag & authorship chips.** Posts render a chip row (topical `tags`) with the AI-authorship disclosure as a colour-set-apart chip (`AI-generated` / `AI 生成`) — same visual family as tags, distinct colour.
- **hreflang.** Every page emits `<link rel="alternate" hreflang="…">` for each sibling version plus `x-default`.

UI chrome strings live in `site/i18n/<lang>.json` (nav, subscribe-widget defaults, banner text, footer, authorship labels); dates format with each language's locale.

`node site/build.mjs` is the entire build — no framework to upgrade, no plugins, no config file. The trade-off, stated honestly: we own every edge case (escaping, relative links, dates). If the script ever grows past a few hundred lines of accumulating features, that's the signal to revisit an off-the-shelf SSG; the markdown transfers as-is.

### 3. Hosting & publishing — GitHub Pages + Actions

- Repo on GitHub; `deploy.yml` on push to `main`: checkout → `node site/build.mjs` → deploy to Pages.
- Custom domain `thalk.chuboyu.space` → `<user>.github.io`, HTTPS enforced.
- **Symmetric routing:** there is no unprefixed page; `/` is a tiny redirector that reads the stored preference (`localStorage`), falls back to `navigator.language`, and sends the reader to `/en/` or `/zh/` (unknown → English).
- Drafts (`draft: true`) build locally with `--drafts` but are excluded from production, so work-in-progress lives safely on `main`.

**Publishing a post is:** write markdown → commit → push. Nothing else. (Whether it also *emails* is a separate, deliberate decision — see §5.)

### 4. Subscribe & support — Firebase Functions + Firestore

One small Firebase project (`thalk-1c092`, region `asia-east1`) with 2nd-gen Cloud Functions (Cloud Run under the hood) and Firestore. Endpoints:

- `POST /subscribe` — `{ email, lang }` → validates, upserts into `subscribers` (`{ email, createdAt, confirmed, source, lang, unsubscribed? }`). Returns 200 regardless of duplicate status (no email enumeration).
- `POST /supportLead` — `{ email, note?, lang }` → writes to `support_leads`.
- `GET /unsubscribe?email=&token=` and `GET /setLanguage?email=&token=&lang=` — per-email tokenized links (HMAC of the email under `THALK_LINK_SECRET`), verified with `timingSafeEqual`, returning a small HTML confirmation page. Public (`allUsers`) because each acts only on the one already-known email its token authorizes.
- `POST /newsletterRecipients` — `{ lang, countOnly? }` → the audience for a language (addresses, or just a count). Admin-only: gated by both the `THALK_ADMIN_SECRET` header *and* an IAM invoker binding restricted to the `thalk-newsletter-invoker` service account (not `allUsers`), since it can return a whole subscriber list. This is the only path the newsletter scripts have to subscriber data — they never hold a Firestore credential.

**The subscribe widget** is not a page; it's one self-contained component (a template function, ~40 lines of shared vanilla JS, a few CSS rules) in three variants — **inline** (on every page, above the footer), **card** (a bordered standalone block), and **nav-button** (a header button that expands in place). All display text is per-instance overridable; state messages ("already subscribed ✓", "subscribed ✓ — thank you") stay uniform. On success it stores the email under `thalk.subscribed` in `localStorage`; inline variants then show "`<email>` already subscribed ✓" to repeat visitors (click to reopen), while the nav variant always opens a fresh input.

**Newsletter language capture.** The widget sends the `lang` of the page the reader subscribed on, stored on `subscribers/{email}`. That `lang` governs which language newsletter they receive and is independently changeable via the `setLanguage` link in every email — decoupled from how they browse the site.

**The support page** is a lead-capture, not a payment system: it explains funding options are coming and offers "leave your email and I'll tell you when it's ready." When payments arrive, the page grows zero-backend links (GitHub Sponsors / Buy Me a Coffee / Stripe Payment Link) and the lead form emails those people. Its form is a separate, plain form (different dataset, has a note field).

**Language selection UX** — three deliberately simple controls: the root detector at `/` (above); a main-page **language selector** on the index (persists to `localStorage`, local only, never sent to a server); and a per-post **"available in" strip** near each title, computed once at build from the group's siblings (no JS), linking only to languages that actually exist for that post.

Guardrails, kept minimal: CORS restricted to the site origin; a honeypot field plus per-IP rate limit (no CAPTCHA unless spam appears); Firestore locked down with no client SDK access — only the functions (Admin SDK) touch it.

**Why not a newsletter SaaS (Buttondown/Mailchimp)?** They'd be less code, but the subscriber list is the one asset that must be owned and portable. Firestore + a JSON export script (`scripts/export-subscribers.mjs`) keeps it in my hands; a SaaS remains an easy later swap since the site only knows a form-post URL.

### 5. Newsletter — plan / send with a git ledger

Sending is a **two-phase, plan-then-send** flow, and send-state lives in a **git-committed ledger** rather than Firestore — so a Firestore wipe can never cause a re-send.

**`syndicate: [email]` marks a post a *candidate*, not an auto-send.** A non-draft post version is a candidate iff its front matter has `email` in `syndicate` **and** its current body hash has no line in the ledger. Each language version is handled independently (its own subscriber pool), so the EN version emails EN subscribers and the ZH version emails ZH subscribers — no dedup concern.

**The ledger — `newsletter/sent.jsonl`.** Append-only, one JSON line per *decision* about a version's current content:

```json
{"key":"small-tools","lang":"en","hash":"sha256:2c5e…","status":"sent","at":"2026-07-11T…","recipients":1}
{"key":"small-tools","lang":"zh","hash":"sha256:e0bb…","status":"skipped","at":"2026-07-11T…"}
```

The `hash` is the post body hash from `hashBody()` in `site/util.mjs` (the same identity used for translation staleness). A version is a candidate only if its *current* hash has no ledger line of any status — so sending or skipping retires it (no nagging), and editing the body (new hash) makes it a candidate again. This is topology-independent: no baseline commit, no `git diff`, immune to rebases/squashes/force-pushes, and it doubles as a durable, wipe-proof audit log.

**Plan phase** (`scripts/newsletter-plan.mjs`, run by the `plan` job on push): from the working tree + ledger it computes the candidates, per-post recipient counts (via `newsletterRecipients` `countOnly`, moving no addresses), the run total, and the *max emails a single subscriber receives* this run. It opens a labelled GitHub **Issue** ("Newsletter plan for `<sha>`") with a task-list checkbox per candidate (checked = will send) and the counts inline. Nothing is sent.

**Send phase** (the `send` job, triggered by a `/send` or `/skip` comment on the plan issue): it emails each **checked** candidate to that language's recipients (reusing `newsletterEmail()`/`newsletterText()` in `site/templates.mjs`, the Resend call, and the per-email unsubscribe/set-language tokens), records each **unchecked** one as `skipped`, appends all decisions to the ledger, commits it (paths-ignored so it doesn't re-trigger plan/deploy; a `GITHUB_TOKEN` push doesn't trigger workflows anyway), comments the result, and closes the issue. De-selecting a post doesn't un-publish it — the site already deployed on push. The ledger is committed per-post right after each send completes, so a mid-batch crash can at most resend the one post in flight (at-least-once).

**Authorization — who can `/send`.** The repo is public, so `issue_comment` fires for anyone; this is built to public standard:

1. **Actor check (required).** The send job runs only when the commenter is the owner and the issue carries the `newsletter-plan` label — `github.event.comment.author_association == 'OWNER'` (set by GitHub, unspoofable) plus the label check. Non-owner comments, and `/send` on any other issue, are ignored.
2. **Environment approval (optional second gate).** A GitHub Environment (`newsletter-send`) with required reviewers pauses the send for an explicit approval. Note: this is not reliably approvable from the GitHub *mobile app* (a platform limitation) — approve from a browser, or rely on the owner-only actor check, which is itself a deliberate mobile-native action via the issue comment.
3. **Least privilege + no injection.** Job `permissions:` are scoped to the minimum (`issues: write`, and `contents: write` only for the ledger commit). All event text (comment/issue body, checkbox lines) is passed via `env:` and parsed in Node — **never** interpolated into a `run:` shell.

**Firestore's role here is minimal:** `newsletterRecipients` (SA-gated, above) is the only Firestore touch; there is no `newsletter_sends` collection — the ledger replaced it. Losing Firestore state therefore can't cause an archive blast; restore `subscribers` from the export backup and carry on.

**Deliverability.** Sends go through **Resend** (generous free tier, plain HTTP API — swappable for SES or any SMTP, since sending is one small script). Each message is multipart (HTML + a plain-text part), sets `Reply-To` to the author address, and carries `List-Unsubscribe` plus the RFC 8058 `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header (the one-click POST hits the same tokenized `unsubscribe` endpoint). Domain auth is via Resend on `thalk.chuboyu.space` (DKIM aligned; SPF on the send-subdomain; DMARC inherited from the parent domain). The dominant deliverability factor for a new domain is sending reputation, which warms over time.

### 6. Social syndication — phase 3 (future)

- Driven by front matter `syndicate: [twitter, threads, facebook]`, honored on **one** designated version per group (default `en`; overridable) — single-language by construction, so no dedup.
- A `syndicate.yml` workflow runs after deploy, diffs newly published posts, and posts "title + description + link" via each platform's API (Meta Graph for Facebook/Threads; X API for Twitter). Tokens in Actions secrets; a state file prevents double-posting.
- Platform APIs are the flaky part, so each target is an independent small script — one breaking doesn't block the others, and the mailing list (which I own) is the primary channel.

### 7. Agent-based releases — phase 4 (design for, don't build)

Because publishing is git-based, an agent "release manager" is just a process that reads a new post (repo or RSS), drafts platform-specific copy, and opens a **pull request** adding it to `syndication/<slug>/`. Merging the PR is the human gate; the phase-3 workflow then posts the approved copy. No new infrastructure — it runs as an Action step (or a local coding-agent session) calling the Claude API.

## Repo layout

```
thalk/
├── docs/
│   ├── thalk.design.md        # this document (the single design source)
│   └── manual.md              # operator's manual (serve, build, publish, deploy, newsletter)
├── site/
│   ├── content/
│   │   ├── en/{posts/,about.md,support.md}
│   │   └── zh/{posts/,about.md,support.md}
│   ├── i18n/{en.json,zh.json} # UI chrome strings
│   ├── templates.mjs          # HTML/email as template-literal functions
│   ├── static/style.css
│   ├── config.mjs, util.mjs   # site config; hashBody + message helper
│   └── build.mjs              # ★ the whole "SSG"
├── functions/index.js         # Firebase Functions (subscribe, supportLead,
│                              #   unsubscribe, setLanguage, newsletterRecipients)
├── newsletter/sent.jsonl      # ★ git send/skip ledger
├── scripts/                   # check-i18n, export-subscribers,
│                              #   newsletter-plan, newsletter-lib, send-newsletter
└── .github/workflows/
    ├── deploy.yml             # build + deploy on push
    └── newsletter.yml         # plan (on push) + send (on /send comment)
```

## Eject / self-host map

| Component | Service | Owned artifact | Eject path |
|---|---|---|---|
| Content | git (GitHub) | markdown files | already just files; any git host |
| Site build | own `build.mjs` | the script + `dist/` | nothing to eject; only `marked`/`gray-matter` are vendorable |
| Hosting | GitHub Pages | `dist/` | any static host — repoint DNS |
| CI | GitHub Actions | workflow YAML | plain Node scripts; run anywhere |
| Forms/API | Firebase Functions | ~250 lines of Node | standard HTTP handlers; wrap in Express, run on any box / Cloud Run |
| Subscriber data | Firestore | `export-subscribers.mjs` → JSON | import into SQLite/Postgres; schedule as backup |
| Send-state | git ledger | `newsletter/sent.jsonl` | already in-repo; nothing to eject |
| Email send | Resend | send script in repo | swap the API call for SES or any SMTP |
| Social posting | platform APIs | per-platform scripts | inherently tied to platforms; mailing list is the owned fallback |

Firebase App Hosting was considered and **not used**: it targets server-rendered apps, and this site is fully static. If SSR is ever needed, App Hosting (or Cloud Run) is the natural landing spot since the Firebase project already exists.

## Phases

| Phase | Status | Delivers |
|---|---|---|
| **1 — Publish** | ✅ done | `build.mjs` + templates, per-language RSS, deploy workflow, custom domain, About + Support pages, subscribe widget, Firebase forms + Firestore |
| **i18n** | ✅ done | Translation-group/provenance model, EN + 繁體中文, symmetric `/en` `/zh` routing + root detector, per-language index/RSS, language selector, per-post "available in" strip, hreflang, provenance banners + staleness, `solo`-aware coverage gate, `authorship` disclosure chips |
| **2 — Reach** | ✅ done | Per-language newsletter via a git ledger + plan/send GitHub flow, unsubscribe + set-language tokenized links, deliverability hardening, subscriber export/backup. (Double opt-in — deferred.) |
| **3 — Syndicate** | ⬜ future | `syndicate` front matter → auto-post to X / Threads / Facebook |
| **4 — Agents** | ⬜ future | Agent-drafted, PR-approved platform-specific release copy |

## Non-goals (for now)

- Comments, analytics dashboards, search, multi-author support, a CMS/admin UI, payments processing (the support page captures intent only until demand exists), double opt-in, and any custom mobile UI (GitHub issues/environments are the operable surface for sends).
