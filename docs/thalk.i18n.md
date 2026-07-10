# thalk — i18n Plan (for discussion)

This extends [thalk.design.md](thalk.design.md) and keeps its principles: static-first, markdown-in, ejectable, don't overkill. Decisions from our discussion are folded in; a few small confirmations remain at the end.

## What makes this blog's i18n unusual

Standard i18n treats one canonical text with N translations of it. That model is wrong here, for two reasons:

1. **English and Chinese are both first-class.** You write both by hand, and a piece may be *arranged differently* in each — not a translation, a re-authoring for a different audience. Neither is "the original."
2. **Transparency is a feature.** When a version *is* machine-produced, the reader is told plainly — which language it came from, by what model, when, and whether it has gone stale since.

So the core model isn't "post + translations." It's a **translation group**: one idea with several *language versions*, each carrying its own **provenance**.

## Core model: groups and versions

A **group** is identified by a stable `key`. Every language version shares the `key`. Each version is one of three provenances:

- **`original`** — written by a human (you). A group can have several originals (EN and ZH both); none is subordinate.
- **`machine`** — produced by AI from a designated base version.
- **`reviewed`** — an AI draft you then edited by hand.

Slugs follow the `key` in every language (your call: simplicity) — so a post is `/en/thinking-out-loud/` and `/zh/thinking-out-loud/`. No per-language slug overrides.

```yaml
# content/en/posts/thinking-out-loud.md
---
key: thinking-out-loud       # ties versions together across languages; also the slug
lang: en
title: "On thinking out loud"
date: 2026-07-08
provenance: original
---
```

```yaml
# content/zh/posts/thinking-out-loud.md
---
key: thinking-out-loud
lang: zh
title: "把思考說出來"
date: 2026-07-08
provenance: original         # independently written, NOT a translation of EN
---
```

When both EN and ZH are `original`, the cross-language link reads *"also written in 中文 (a separate version)"*, not *"translation"* — truthful, and it honors the cultural-arrangement point.

## Language scope & the pre-publish gate

**Launch is EN + ZH, both human `original`. **ZH is Traditional Chinese** throughout: the internal language code and URL prefix stay short as `zh` (so `/zh/…`), but the display label is **繁體中文**, `<html lang>` and `hreflang` use `zh-Hant`, and dates format with the `zh-Hant-TW` locale.** thalk itself does **not** perform AI translation — a separate agent you launch owns that. This doc only fixes the *scope* the machinery must support (the group/version/provenance model, `machine`/`reviewed` states, `/xx/` routing) so that agent has a well-defined slot to write into.

**Before publishing, missing languages are surfaced for approval.** The baseline expectation is that every group has both `en` and `zh`. A `scripts/check-i18n.mjs` (run in CI and locally before publish) reports any group missing an expected language. To *approve* an intentional single-language post, you mark the existing version:

```yaml
solo: true    # "this piece is intentionally one language" — silences the gap check
```

The act of adding `solo: true` **is** the approval, and it's recorded in git. Without it, a group missing EN or ZH makes the check fail loudly, so nothing publishes half-translated by accident. (This replaces an interactive prompt with a static, reviewable flag that works in CI — see confirmation #1 below.)

## Provenance surfaced to the reader (the transparency layer)

Every non-`original` page carries a **provenance banner** at the top:

> 🤖 AI translation from the English original, by claude-fable-5 on 2026-07-09. [Read the original ›](/en/posts/thinking-out-loud/) · [report a translation error](…)

`reviewed` softens the wording ("AI translation, edited by a human"). `original` pages show no banner.

Deeper transparency, cheap because the repo is public and translations are committed markdown:

- **Staleness.** A `baseHash` in each `machine`/`reviewed` version records the base's body at translation time. The build recomputes it; a mismatch shows *"the original has changed since this translation — it may be out of date"* and prints a build warning.
- **Traceability.** "See this translation's source / history" is a link to GitHub blame. Provenance is also echoed into RSS and a `<meta>` block for agents/aggregators.
- **Policy note.** A short `/about` section stating the rule in the open: EN & ZH hand-written and may differ by design; other languages are AI from a named base; how to read originals and report errors.

## Language selection UX

Three distinct, deliberately simple controls:

1. **Root detector at `/`.** Symmetric routing means there is no unprefixed page; `/` is a tiny redirector that reads the stored preference (`localStorage`), falls back to `navigator.language`, and sends the reader to `/en/` or `/zh/` (unknown → English).
2. **Main-page language selector (your point 7).** The index page carries the primary language chooser. Selecting a language **persists in `localStorage`, locally only** — never sent to any server, never tied to an account — and navigates to that language's home. This is the site-wide reading preference the root detector then honors on return visits.
3. **Per-post version component (your point 6).** Each post renders a very small, static "available in" strip near its title — one-click links to the *available* language versions of that same post (e.g. `EN · 中文`). It's computed once at build from the group's siblings (no JavaScript, no runtime logic — a one-time render), and only lists languages that actually exist for that post.

Every page also emits `<link rel="alternate" hreflang="…">` for each sibling version plus `x-default`, so search engines understand the relationships without a server.

## Build changes

`build.mjs` gains a language loop:

- Load `site/i18n/<lang>.json` for UI strings; format dates with `toLocaleDateString(lang)`; set `<html lang>` (and `dir` later if an RTL language ever appears).
- Group files by `key`; compute sibling links + provenance for the per-post component, banners, and hreflang.
- Emit per-language index (listing only posts present in that language), per-language RSS (`/en/rss.xml`), and the root detector.
- Recompute `baseHash` for staleness warnings; run the `solo`-aware coverage check.

The message catalog (`site/i18n/*.json`) covers UI chrome only — nav labels, subscribe-widget defaults, banner text, "read original", footer. EN/ZH strings are hand-written; any future AI-language strings are that separate agent's concern.

## Social syndication — single language (your constraint)

Unchanged and single-language by construction: the `syndicate` front matter is honored on **one** designated version per group (default the base, `en`; overridable per group). Other language versions never syndicate — no dedup logic.

## Subscribe & newsletter language

- **Store `lang` now.** The subscribe endpoint gains an optional `lang` field, captured from the page the reader subscribed on and written to `subscribers/{email}`. Costs nothing today; makes per-language sending possible in phase 2.
- **Subscribers can switch language — newsletter only.** A subscriber's `lang` governs *which language newsletter they receive* and is independently changeable, decoupled from how they browse the site. Mechanism (phase 2, when sending exists): a tokenized preference link in every email → a tiny page that updates `lang`. Nothing to build now beyond storing the field; the data model just needs to allow updating it.
- **Built (i18n-3):** `syndicate: [email]` is honored independently per language version — unlike social syndication's single-designated-version rule, each language has its own subscriber pool, so the EN version emails EN subscribers and the ZH version emails ZH subscribers with no dedup concern. `unsubscribe` and `setLanguage` Cloud Functions handle the tokenized links; `scripts/send-newsletter.mjs` (run from a `newsletter.yml` GitHub Action on every push, idempotent on content hash) does the sending. It never holds a Firestore credential itself — two more functions, `newsletterRecipients` and `newsletterMarkSent`, are the only path to subscriber data, keeping "only functions touch Firestore" true for CI the same way it's true for readers. Those two carry a second lock beyond the app-level `THALK_ADMIN_SECRET`: unlike every other function here, their Cloud Run invoker IAM binding is restricted to one dedicated service account (`thalk-newsletter-invoker`) instead of `allUsers` — they're the only endpoints that can return a whole subscriber list rather than act on one already-known email, so a leaked app secret alone isn't enough to reach them.

## Phasing

| Phase | Delivers |
|---|---|
| **i18n-1** | Group/version/provenance model; `/en` + `/zh` (both human `original`); slug = key; per-language index/RSS; root detector; main-page selector (local-only); per-post version component; hreflang; message catalog; `solo`-aware pre-publish check; policy note. Migrate current EN-at-root content into `content/en/`. Subscribe endpoint stores `lang`. |
| **i18n-2** | Provenance banners + staleness rendering + `<meta>`/RSS provenance — the read-side surface the *separate translation agent* fills. (thalk provides the slots; the agent provides `machine`/`reviewed` files.) |
| **i18n-3** | Per-language newsletter sending + subscriber language-switch preference page. |

**Migration note:** moving EN from root to `/en/` changes current URLs — trivial now (one post), and worth doing before content accrues. Old paths kept working with redirects if any are already shared.

## Confirmations before I build i18n-1

1. **Approval mechanism:** approve intentional single-language posts with an explicit `solo: true` flag (static, recorded in git, CI-friendly) rather than an interactive prompt — good?
2. **Per-post component placement:** the "available in EN · 中文" strip near the top of each post (by the date/meta), rather than at the foot — agree?
3. **Default subscribe language:** default a new subscriber's `lang` to the language of the page they subscribed from (overridable later via the newsletter preference link) — right?
4. **`solo` baseline:** the expected set is exactly `{en, zh}` — a group with only one of them (and no `solo`) fails the check. Correct baseline?
