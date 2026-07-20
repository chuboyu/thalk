# thalk

Personal publishing channel at [thalk.chuboyu.space](https://thalk.chuboyu.space).

- **Operator's manual** (serve, build, publish, deploy, newsletter): [docs/manual.md](docs/manual.md)
- **Design**: [docs/thalk.design.md](docs/thalk.design.md)

## Writing

Start a draft from the templates:

```sh
npm run new -- "Multiplied, not Optimized"
```

That writes `site/content/{en,zh}/posts/<today>-multiplied-not-optimized.md` from `templates/post.<lang>.md`, with `key`, `lang`, `title` and `date` filled in and `draft: true` set. Write, preview with `npm run serve`, flip `draft: false`, commit, push — GitHub Actions builds and deploys. Every post is expected in both `en` and `zh` unless marked `solo: true`. See [docs/manual.md](docs/manual.md) for details.

## Commands

### Writing

```sh
npm run new -- "Post Title"                 # draft in every requiredLang (en, zh)
npm run new -- "Post Title" --lang=en       # one language only (pair with solo: true)
npm run new -- "Post Title" --lang=en,zh,ja # ja falls back to the en template
npm run new -- "Post Title" --key=custom-slug --date=2026-08-01
npm run new -- "Post Title" --force         # overwrite existing files
```

`--key` defaults to the slugified title (required for non-Latin titles), `--date` to today.

### Build & preview

```sh
npm run serve          # build with drafts + serve on :4173
npm run build          # i18n gate, then build → dist/ (production, no drafts)
npm run build:drafts   # include draft posts, skip the gate
npm run check          # i18n coverage gate on its own
```

### Newsletter

```sh
npm run newsletter:plan                      # list pending candidates + email counts
npm run newsletter:plan -- --no-counts       # list candidates offline (no network/credentials)
npm run newsletter:plan -- --out=plan.json --issue-body=body.md   # machine artifacts (CI)
npm run newsletter:dry                       # preview the send/skip split, offline, no sends
npm run newsletter:send -- --all             # send every pending post
npm run newsletter:send -- --select=post:key:en,post:key:zh   # send these, skip the rest
npm run newsletter:send -- --skip-all        # record all pending as skipped
npm run newsletter:send -- --from-issue      # CI path: THALK_COMMAND + THALK_ISSUE_BODY
```

Real sends need `THALK_ADMIN_SECRET`, `GOOGLE_APPLICATION_CREDENTIALS`, `RESEND_API_KEY` and `THALK_LINK_SECRET`. Add `--dry-run` to any `newsletter:send` invocation to preview without sending or writing the ledger.

### Ops

```sh
node scripts/export-subscribers.mjs > backup.json         # export subscribers + support leads
firebase deploy --only functions --project thalk-1c092    # deploy backend endpoints
```

The export needs application-default credentials (`gcloud auth application-default login`).
