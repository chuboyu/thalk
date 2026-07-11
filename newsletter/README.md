# newsletter/

Send-state for the mailing list, kept in git (not Firestore) so it's durable and
survives a Firestore wipe. See `docs/thalk.publish.send.revisit.md` for the design.

## `sent.jsonl`

Append-only log, one JSON object per line, one line per **decision** about a post
version's current content:

```json
{"key":"hello-thalk","lang":"en","hash":"sha256:1a2b…","status":"sent","at":"2026-07-11T09:00:00Z","recipients":42}
{"key":"draft-notes","lang":"zh","hash":"sha256:9f8e…","status":"skipped","at":"2026-07-11T09:00:00Z"}
```

- `key` + `lang` identify the post version; `hash` is its body hash
  (`hashBody()` in `site/util.mjs`) at the time of the decision.
- `status` is `sent` or `skipped`.
- A post version is a **candidate** for the newsletter only if its *current* body
  hash has no line here (any status). So sending or skipping retires it; editing
  the post (new hash) makes it a candidate again.

Never edit by hand except to resolve a merge; the plan/send scripts append to it.
