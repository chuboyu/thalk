# thalk — Design

**thalk** is a personal publishing channel at `https://thalk.chuboyu.space`: a blog written in markdown, published by me (usually through a coding agent), readable by everyone, subscribable by email, with a support page that captures funding intent, and — over time — automated syndication to social networks.

## Principles

1. **Static first.** Everything that can be a static file is a static file. Dynamic behavior is limited to two tiny endpoints (subscribe, support lead).
2. **Markdown in, everything out.** The git repo is the single source of truth. A post is a `.md` file with front matter; publishing is `git push`.
3. **Ejectable at every layer.** No component may hold data or behavior that can't be replaced in an afternoon. Concretely: content is plain markdown in git, the site builds to plain HTML with one command, subscriber data is exportable as JSON/CSV, and every third-party service has a named replacement (see the eject table).
4. **Don't overkill.** No CMS, no database for content, no auth system, no comment system. Features arrive in phases only when the previous phase is actually in use.

## Architecture at a glance

```
                       ┌─────────────────────────────────────────────┐
 write .md ──► git push ──► GitHub Actions ──► build (own script) ──► GitHub Pages
                       │        │                                    │
                       │        └─► (phase 3) syndication job        ▼
                       │             posts to X / Threads / FB   thalk.chuboyu.space
                       │             + sends newsletter email        │
                       └─────────────────────────────────────────────┤
                                                                     │ subscribe / support forms (fetch)
                                                                     ▼
                                                    Firebase Cloud Functions (Cloud Run, 2nd gen)
                                                                     │
                                                                     ▼
                                                    Firestore: subscribers, support_leads
```

Two halves, deliberately decoupled:

- **The site** — static, built from markdown, hosted on GitHub Pages. Has zero runtime dependencies; if every dynamic service dies, the blog stays up.
- **The services** — a single small Firebase Functions codebase handling form submissions, writing to Firestore. The site calls it with plain `fetch`; if it's down, only the forms degrade.

## Components

### 1. Content

- Posts live in `site/content/posts/*.md`. Pages like About and Support are markdown files under `site/content/` too.
- Front matter convention:

  ```yaml
  ---
  title: "On thinking out loud"
  date: 2026-07-08
  description: "One-line summary used in lists, RSS, and social posts."
  draft: false            # drafts build locally, never deploy
  tags: [thinking]
  syndicate: []           # phase 3: e.g. [email, twitter, threads, facebook]
  ---
  ```

- Content updates come only from commits to `main` — by me directly or via a coding agent opening changes I approve. There is no web editor and no admin panel; git history *is* the audit log.

### 2. Site build — our own script, no SSG

No Astro, no Hugo, no Eleventy. The "static site generator" is a single script in the repo (`site/build.mjs`, ~200 lines of Node) because the actual job is small and fixed:

1. Read every `.md` under `site/content/`, parse front matter, skip `draft: true`.
2. Render markdown to HTML and pour it into a handful of HTML templates (plain template-literal functions — no template language).
3. Emit `dist/`: the post pages, the index, about/subscribe/support pages, `rss.xml`, and a copy of `site/static/` (one CSS file, images).

`node site/build.mjs` is the entire build. There is no framework to upgrade, no plugin ecosystem, no config file — restyling the site means editing an HTML string and a CSS file.

Two library dependencies are allowed, because writing a correct markdown parser is the one part that *would* be overkill to hand-roll: **`marked`** (markdown → HTML) and **`gray-matter`** (front matter). Both are small, stable, dependency-light libraries — code we run, not services we depend on — and either could be vendored into the repo if even npm feels like too much of a tether. RSS generation is done by hand (it's ~30 lines of string building; the only subtlety is XML-escaping, which is one helper function).

The trade-off, stated honestly: we own every edge case (escaping, relative links, date formatting). For a single-author blog with a stable design, that's a few hours once — cheaper than carrying a framework forever. If the script ever grows past a few hundred lines of accumulating features, that's the signal to revisit an off-the-shelf SSG; the markdown content transfers as-is.

The site includes:

- `/` — post list, `/posts/<slug>/` — posts, `/about/`
- `/rss.xml` — full-content RSS feed. This is also the machine interface: syndication (phase 3) and any future agent tooling read the feed rather than scraping HTML.
- `/subscribe/` — email signup form
- `/support/` — support page (see §4)

### 3. Hosting & publishing — GitHub Pages + Actions

- Repo on GitHub; a `deploy.yml` workflow on push to `main`: checkout → `node site/build.mjs` → deploy to Pages via `actions/deploy-pages`.
- Custom domain: `CNAME` record for `thalk.chuboyu.space` → `<user>.github.io`, domain set in Pages settings, enforce HTTPS. 
- Drafts (`draft: true`) are excluded from production builds, so work-in-progress can live on `main` without publishing.

**Publishing a post is:** write markdown → commit → push. Nothing else.

### 4. Subscribe & support — Firebase Functions + Firestore

One small Firebase project (`thalk`) with 2nd-gen Cloud Functions (these run on Cloud Run under the hood) and Firestore:

- `POST /subscribe` — `{ email }` → validates, upserts into `subscribers` collection (`{ email, createdAt, confirmed, source }`). Returns 200 regardless of duplicate status (no email enumeration). Double opt-in confirmation email is a phase-2 refinement; start with single opt-in.
- `POST /support-lead` — `{ email, note? }` → writes to `support_leads` collection.

**The support page** is intentionally a lead-capture, not a payment system: it explains that funding options are coming, and offers "leave your email and I'll tell you when it's ready." That satisfies requirement 3 today without integrating Stripe/GitHub Sponsors prematurely — and the leads list tells me when demand justifies building it. When payments do arrive, the page grows links (GitHub Sponsors / Buy Me a Coffee / Stripe Payment Link — all zero-backend options) and the lead form emails those people.

Guardrails, kept minimal:

- CORS restricted to `https://thalk.chuboyu.space`.
- A honeypot field plus a per-IP rate limit in the function (no CAPTCHA unless spam actually appears).
- Firestore locked down: no client SDK access at all; only the functions touch it.

**Why not a newsletter SaaS (Buttondown/Mailchimp) instead?** They'd be less code, but the subscriber list is the one asset that must be owned and portable. Firestore + a JSON export script keeps it in my hands; a SaaS remains an easy later swap since the site only knows a form-post URL.

### 5. Newsletter sending — phase 2

- A `newsletter.yml` GitHub Action, manually triggered (`workflow_dispatch`) or triggered by front matter `syndicate: [email]` on a newly published post.
- It renders the post's markdown to a simple HTML email and sends to all confirmed subscribers via **Resend** (generous free tier, plain HTTP API) — swappable for SES or any SMTP since sending is one small script in the repo.
- Unsubscribe: a `GET /unsubscribe?token=…` function endpoint; token is an HMAC of the email, link included in every send. (`List-Unsubscribe` header included for deliverability.)

### 6. Social syndication — phase 3

- Driven by front matter: `syndicate: [twitter, threads, facebook]`.
- A `syndicate.yml` workflow runs after deploy, diffs newly published posts, and posts "title + description + link" via each platform's API (Meta Graph API covers Facebook Pages and Threads; X API for Twitter). Tokens live in GitHub Actions secrets.
- A `syndicated.json` state file (committed back, or stored in Firestore) prevents double-posting.
- Platform APIs are the flaky part (X pricing, Meta app review), so each target is an independent small script — one breaking doesn't block the others, and the mailing list (which I own) is the primary channel.

### 7. Agent-based releases — phase 4 (design for, don't build)

The groundwork above makes this cheap later:

- Because publishing is git-based, an agent "release manager" is just a process that reads a new post (via repo or RSS), drafts platform-specific copy (a thread for X, a longer Facebook post, a teaser for Threads), and opens a **pull request** adding the drafts to a `syndication/<slug>/` folder.
- Merging the PR is the human approval gate; the phase-3 workflow then posts the approved copy instead of the generic "title + link".
- No new infrastructure: the agent runs as a GitHub Action step (or locally as a coding-agent session) calling the Claude API. Approval-by-merge keeps a human in the loop until fully autonomous posting is deliberately enabled.

## Repo layout

```
thalk/
├── docs/
│   └── thalk.design.md        # this document
├── site/
│   ├── content/
│   │   ├── posts/             # ★ the actual writing, plain .md
│   │   ├── about.md
│   │   ├── subscribe.md
│   │   └── support.md
│   ├── templates.mjs          # HTML as template-literal functions
│   ├── static/                # style.css, images, favicon
│   └── build.mjs              # ★ the whole "SSG", ~200 lines
├── functions/                 # Firebase Functions (subscribe, support-lead, unsubscribe)
│   ├── src/index.ts
│   └── firebase.json
├── scripts/                   # send-newsletter.ts, syndicate/*.ts, export-subscribers.ts
└── .github/workflows/
    ├── deploy.yml             # phase 1
    ├── newsletter.yml         # phase 2
    └── syndicate.yml          # phase 3
```

## Eject / self-host map

| Component | Service | Owned artifact | Eject path |
|---|---|---|---|
| Content | git (GitHub) | markdown files | it's already just files; any git host |
| Site build | our own `build.mjs` | the script itself + HTML in `dist/` | nothing to eject — already self-owned; only deps (`marked`, `gray-matter`) are vendorable |
| Hosting | GitHub Pages | `dist/` | any static host (Cloudflare Pages, Netlify, nginx on a VPS) — repoint DNS |
| CI | GitHub Actions | workflow YAML | plain shell scripts; run anywhere |
| Forms API | Firebase Functions | ~200 lines of Node in repo | it's a standard HTTP handler; wrap in Express and run on any box / Cloud Run directly |
| Data | Firestore | `export-subscribers.ts` → JSON/CSV | import into SQLite/Postgres; run export on a schedule as backup |
| Email send | Resend | sending script in repo | swap API call for SES or any SMTP |
| Social posting | platform APIs | per-platform scripts | inherently tied to platforms; mailing list is the owned fallback channel |

Firebase App Hosting was considered and **not used**: it targets server-rendered apps, and this site is fully static. GitHub Pages is simpler and free. If the site ever needs SSR, App Hosting (or Cloud Run) is the natural landing spot since the Firebase project already exists.

## Phases

| Phase | Delivers | Requirements covered |
|---|---|---|
| **1 — Publish** | `build.mjs` + templates, RSS, deploy workflow, custom domain, About + Support (lead form) + Subscribe pages, Firebase functions + Firestore | 1, 2 (page + list capture), 3, 4 |
| **2 — Reach** | Newsletter sending (Resend), unsubscribe, optional double opt-in, subscriber export/backup script | 2 (complete), 5 (mailing list) |
| **3 — Syndicate** | `syndicate` front matter → auto-post to X / Threads / Facebook | 5 (complete) |
| **4 — Agents** | Agent-drafted, PR-approved platform-specific release copy | 6 |

## Non-goals (for now)

- Comments, analytics dashboards, search, multi-author support, a CMS/admin UI, payments processing (support page captures intent only until demand exists).
