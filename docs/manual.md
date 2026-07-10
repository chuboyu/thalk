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

A newsletter is sent for any **non-draft post version whose front matter
`syndicate` array includes `email`**. Each language version emails only the
subscribers whose stored `lang` matches it.

### Automatic (normal path)

Add `email` to `syndicate` and push:

```yaml
syndicate: [email]
```

The `.github/workflows/newsletter.yml` action runs on every push to `main`. It
is **idempotent**: each post version is tracked by a content hash in the
`newsletter_sends` Firestore collection, so it sends **once** and re-runs are
no-ops until the body changes. Editing a typo and re-pushing will resend (the
hash changed) — keep that in mind.

### Manual / local

Requires env vars: `THALK_ADMIN_SECRET`, `THALK_LINK_SECRET`, `RESEND_API_KEY`,
and `GOOGLE_APPLICATION_CREDENTIALS` pointing at a `thalk-newsletter-invoker`
service-account key (the script authenticates as that SA to reach the
IAM-restricted functions).

```sh
npm run newsletter:dry     # show what WOULD send + recipient counts; no sends, no writes
npm run newsletter         # actually send, then record the send
```

Bypass the already-sent check for a deliberate resend of one version:

```sh
node scripts/send-newsletter.mjs --force=post:<slug>:<lang>
```

The dry run only ever prints **recipient counts**, never addresses. Sending
from address is `news@thalk.chuboyu.space` (Resend); change it in
`site/config.mjs` (`newsletterFrom`).

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
| Dry-run newsletter | `npm run newsletter:dry` |
| Send newsletter | `npm run newsletter` (or push with `syndicate: [email]`) |
| Back up subscribers | `node scripts/export-subscribers.mjs > backup.json` |
