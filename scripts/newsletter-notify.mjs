// Operator confirmation phase. Runs when the operator comments `/send` on a plan
// issue, BEFORE the gated send job. It computes the full plan — titles, per-post
// recipient counts, totals, per-locale fatigue — and emails it to the operator,
// stamped with a plan id (the issue number + the commit the plan was cut from).
//
// The operator reads this mail, then approves the send deployment in GitHub,
// matching the id so they know they are approving the trigger this mail
// describes. None of this detail is ever written to the public log; only the id
// and the ids of the posts are. See docs/manual.md → "Newsletter".
//
//   THALK_ISSUE_BODY=<body> THALK_ISSUE_NUMBER=<n> THALK_PLAN_ID=<sha7> \
//     node scripts/newsletter-notify.mjs
//
// Needs RESEND_API_KEY + THALK_OPERATOR_EMAIL to mail, and THALK_ADMIN_SECRET +
// GOOGLE_APPLICATION_CREDENTIALS (invoker SA) to read counts.
import { pendingCandidates, sendId, recipientCount, checkedIdsFromIssue, sendMail } from './newsletter-lib.mjs';
import site from '../site/config.mjs';

const operator = process.env.THALK_OPERATOR_EMAIL;
const issueNumber = process.env.THALK_ISSUE_NUMBER || '?';
const planId = process.env.THALK_PLAN_ID || '?';
if (!operator) {
  console.error('THALK_OPERATOR_EMAIL is required');
  process.exit(1);
}

// What `/send` will actually dispatch: pending candidates the operator left
// checked. Same reading of the same checkboxes the send phase uses, so the mail
// and the send never disagree.
const checked = checkedIdsFromIssue(process.env.THALK_ISSUE_BODY);
const toSend = pendingCandidates()
  .filter((v) => checked.has(sendId(v)))
  .sort((a, b) => a.key.localeCompare(b.key) || a.lang.localeCompare(b.lang));

const idTag = `issue #${issueNumber} · ${planId}`;

if (!toSend.length) {
  // Nothing checked/pending — still tell the operator, so silence never reads as
  // "the mail got lost." The send job will simply record skips.
  await sendMail({
    from: site.newsletterFrom,
    to: operator,
    replyTo: site.email,
    subject: `[thalk] /send on ${idTag} — nothing to dispatch`,
    text: `No checked, still-pending posts for ${idTag}. Approving the send will dispatch no email.\n`,
    html: `<p>No checked, still-pending posts for <code>${idTag}</code>. Approving the send will dispatch no email.</p>`
  });
  console.log(`notified operator: nothing to dispatch for ${idTag}`);
  process.exit(0);
}

// One count per language — every post of a language shares the audience.
const counts = {};
for (const lang of [...new Set(toSend.map((v) => v.lang))]) counts[lang] = await recipientCount(lang);

const rows = toSend.map((v) => ({ sendId: sendId(v), lang: v.lang, title: v.title, recipients: counts[v.lang] }));
const totalEmails = rows.reduce((n, r) => n + r.recipients, 0);
const perLang = {};
for (const v of toSend) perLang[v.lang] = (perLang[v.lang] || 0) + 1;
const fatigue = Object.entries(perLang)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([lang, n]) => `${lang}: ${n}`)
  .join(', ');

const lines = [
  `Plan id: ${idTag}`,
  `Approve the send deployment in GitHub only if this id matches the one shown there.`,
  ``,
  `Posts to dispatch (${rows.length}):`,
  ...rows.map((r) => `  • ${r.title} [${r.lang}] — ${r.recipients} recipient(s) — ${r.sendId}`),
  ``,
  `Total emails this run: ${totalEmails}`,
  `Emails per subscriber, per locale: ${fatigue}`,
  ``
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html =
  `<p><strong>Plan id: <code>${esc(idTag)}</code></strong><br>` +
  `Approve the send deployment in GitHub only if this id matches the one shown there.</p>` +
  `<p>Posts to dispatch (${rows.length}):</p><ul>` +
  rows.map((r) => `<li><strong>${esc(r.title)}</strong> [${esc(r.lang)}] — ${r.recipients} recipient(s) — <code>${esc(r.sendId)}</code></li>`).join('') +
  `</ul><p>Total emails this run: <strong>${totalEmails}</strong><br>` +
  `Emails per subscriber, per locale: ${esc(fatigue)}</p>`;

await sendMail({
  from: site.newsletterFrom,
  to: operator,
  replyTo: site.email,
  subject: `[thalk] confirm newsletter send — ${idTag} — ${totalEmails} email(s)`,
  text: lines.join('\n'),
  html
});

// Public log: the id and the post ids only. Never the counts above.
console.log(`emailed operator the plan for ${idTag}: ${rows.length} post(s) — ${rows.map((r) => r.sendId).join(', ')}`);
