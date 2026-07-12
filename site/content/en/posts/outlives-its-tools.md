---
key: outlives-its-tools
lang: en
title: "a place that outlives its tools"
description: "The thesis behind thalk — own the medium, and keep it simple enough to hold in your head."
date: 2026-07-12
draft: false
tags: [meta, building, thesis]
syndicate: [email]
provenance: original
authorship: ai-assisted
---

Every platform I've published on eventually asked me to change. The feed reordered itself. The editor grew a paywall. The API I'd built against was deprecated with six weeks' notice. None of it was hostile — it's just what platforms do. But each time, my writing had to bend around someone else's roadmap, and each time I owned a little less of the thing I'd made.

thalk is my attempt to stop renting, renting my own content.

It is where I think and talk — hence the name. It's also a small bet on where things are heading: people and communities owning their own small, purpose-built services outright, instead of cramming every different need into the sardine can we call platform.

The whole site is plain markdown files in a git repository. That isn't an implementation detail; it's the thesis. The files are the source of truth — not a database, not a CMS, not some service's export button I'm hoping still works the day I need it. Publishing is a `git push`. If I want to leave GitHub tomorrow, I copy a folder. There's nothing to migrate because there was never anything to lock in.

Everything downstream is arranged so it can be replaced in an afternoon. The site "generator" is a few hundred lines of my own code, not a framework I have to keep current. The pages are static: if every dynamic piece — the forms, the mailing list, the functions — went dark at once, the writing would still be sitting there as flat HTML. Each moving part has a written-down escape hatch, so no single service can hold the rest hostage.

Some of that ownership is about honesty, not just durability. This is a bilingual site, and the English and Chinese are both first-class — often not translations of each other but the same idea re-said for a different reader. When a page *is* machine-made — an AI translation, or something I drafted with a model's help — it says so, plainly, on the page. (This one does.) I'd rather you trust the parts that are mine because you can see which parts aren't.

The last principle is restraint. No comment system, no analytics dashboard, no admin panel, no feature added just because it was possible. Things arrive only when the simpler version has actually been used and found wanting. It's easy to mistake a pile of features for a finished thing; I'd rather this stay small enough to hold in my head all at once.

None of this makes the writing better. But it makes it *mine* — durable, portable, honest, and simple enough to understand completely. That felt like the right ground to stand on before writing a single word worth keeping.
