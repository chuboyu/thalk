// Build the newsletter send plan: which syndicatable post versions have no
// ledger decision yet, how many emails each would send, the run total, and the
// most a single subscriber would receive. Emits a human summary to stdout, and
// optionally a machine artifact (--out=) and a GitHub issue body with a checkbox
// per post (--issue-body=).
//
//   node scripts/newsletter-plan.mjs [--out=plan.json] [--issue-body=body.md] [--no-counts]
//
// Counts need THALK_ADMIN_SECRET + GOOGLE_APPLICATION_CREDENTIALS (the
// thalk-newsletter-invoker service account). --no-counts lists candidates
// offline (no network, no credentials).
import fs from 'node:fs';
import { pendingCandidates, sendId, recipientCount } from './newsletter-lib.mjs';

const args = process.argv.slice(2);
const noCounts = args.includes('--no-counts');
const outPath = valueOf('--out');
const bodyPath = valueOf('--issue-body');

function valueOf(flag) {
  const a = args.find((x) => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : null;
}

const candidates = pendingCandidates().sort(
  (a, b) => a.key.localeCompare(b.key) || a.lang.localeCompare(b.lang)
);

// One count per language — every candidate of a language shares the same audience.
const counts = {};
if (!noCounts && candidates.length) {
  for (const lang of [...new Set(candidates.map((c) => c.lang))]) {
    counts[lang] = await recipientCount(lang);
  }
}

const rows = candidates.map((c) => ({
  sendId: sendId(c),
  key: c.key,
  lang: c.lang,
  hash: c.bodyHash,
  title: c.title,
  recipientCount: noCounts ? null : counts[c.lang]
}));

const totalEmails = noCounts ? null : rows.reduce((n, r) => n + r.recipientCount, 0);
// A subscriber receives one email per candidate in their language.
const perLang = {};
for (const c of candidates) perLang[c.lang] = (perLang[c.lang] || 0) + 1;
const maxPerSubscriber = Object.values(perLang).reduce((m, n) => Math.max(m, n), 0);

// ── Human summary ─────────────────────────────────────────────────────────────
if (!candidates.length) {
  console.log('Newsletter plan: nothing to send (no undecided syndicatable posts).');
} else {
  const head = `Newsletter plan — ${candidates.length} post(s)` + (noCounts ? '' : `, ${totalEmails} email(s)`);
  console.log(head + ':\n');
  for (const r of rows) {
    const rc = r.recipientCount == null ? '?' : r.recipientCount;
    console.log(`  ${r.sendId}  ${JSON.stringify(r.title)}  → ${rc} recipient(s)`);
  }
  if (!noCounts) {
    console.log(`\nTotal emails: ${totalEmails}`);
    console.log(`Most a single subscriber receives this run: ${maxPerSubscriber}`);
  }
}

// ── Machine artifact ──────────────────────────────────────────────────────────
if (outPath) {
  const plan = { generatedAt: new Date().toISOString(), candidates: rows, totalEmails, maxPerSubscriber };
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2) + '\n');
}

// ── Issue body (checkbox per post) ────────────────────────────────────────────
if (bodyPath) fs.writeFileSync(bodyPath, renderIssueBody(rows, totalEmails, maxPerSubscriber));

function renderIssueBody(rows, total, maxPer) {
  if (!rows.length) return 'No posts are pending a newsletter send.\n';
  return (
    [
      'Uncheck any post to **skip** sending it — it stays published on the site. ' +
        'Comment `/send` to dispatch the checked posts, or `/skip` to record all as skipped and close.',
      '',
      ...rows.map((r) => {
        const rc = r.recipientCount == null ? '?' : `${r.recipientCount} recipient(s)`;
        return `- [x] **${r.title}** — \`${r.lang}\` — ${rc} · \`${r.sendId}\``;
      }),
      '',
      `**Total:** ${total == null ? '?' : total} email(s) · most to any single subscriber: ${maxPer}`,
      ''
    ].join('\n')
  );
}
