// Newsletter send phase. Operates on the current *pending* candidates (post
// versions with `syndicate: [email]` and no decision yet in newsletter/sent.jsonl)
// and records a decision for each: `sent` or `skipped`. It appends to the ledger
// but does NOT git-commit — CI (or you, locally) commits newsletter/sent.jsonl.
//
//   node scripts/send-newsletter.mjs --all              # send every pending post
//   node scripts/send-newsletter.mjs --select=post:a:en,post:a:zh   # send these, skip the rest
//   node scripts/send-newsletter.mjs --skip-all         # record all pending as skipped
//   node scripts/send-newsletter.mjs --from-issue       # CI: THALK_COMMAND + THALK_ISSUE_BODY
//   ... plus --dry-run to preview (no sends, no ledger writes)
//
// Because the send set comes from the git ledger, a Firestore wipe cannot cause a
// re-send. Needs THALK_ADMIN_SECRET + GOOGLE_APPLICATION_CREDENTIALS (invoker SA),
// and for real sends RESEND_API_KEY + THALK_LINK_SECRET.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import site from '../site/config.mjs';
import { makeT } from '../site/util.mjs';
import { newsletterEmail, newsletterText } from '../site/templates.mjs';
import { pendingCandidates, sendId, recipientsFor, appendLedger } from './newsletter-lib.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sendAll = args.includes('--all');
const skipAll = args.includes('--skip-all');
const fromIssue = args.includes('--from-issue');
const selectArg = args.find((a) => a.startsWith('--select='));

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const LINK_SECRET = process.env.THALK_LINK_SECRET;
if (!dryRun && (!RESEND_API_KEY || !LINK_SECRET)) {
  console.error('RESEND_API_KEY and THALK_LINK_SECRET are required (unless --dry-run)');
  process.exit(1);
}

function sign(email) {
  return crypto.createHmac('sha256', LINK_SECRET).update(email).digest('hex').slice(0, 32);
}

// Strip anything email-shaped out of text bound for the console. Provider error
// bodies quote the offending address back at you, and this script's output ends
// up in a public Actions log and a public issue comment.
function redact(s) {
  return String(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]');
}

// Extract the set of `post:key:lang` ids that are checked in a plan issue body.
// Parsing untrusted issue text in JS (never a shell), and only accepting the
// controlled `post:<key>:<lang>` shape, keeps a crafted comment inert.
function checkedIdsFromIssue(body) {
  const ids = new Set();
  for (const line of (body || '').split('\n')) {
    const m = /^\s*-\s*\[( |x|X)\]\s.*`(post:[A-Za-z0-9._-]+:[a-z]{2,8})`/.exec(line);
    if (m && m[1].toLowerCase() === 'x') ids.add(m[2]);
  }
  return ids;
}

// Decide, from the CLI/CI inputs, which pending candidates to send vs skip.
function resolveSelection(pending) {
  if (sendAll) return { toSend: pending, toSkip: [] };
  if (skipAll) return { toSend: [], toSkip: pending };
  let selected;
  if (fromIssue) {
    const command = (process.env.THALK_COMMAND || '').trim();
    if (command === 'skip') return { toSend: [], toSkip: pending };
    if (command !== 'send') {
      console.error(`--from-issue expects THALK_COMMAND=send|skip, got "${command}"`);
      process.exit(1);
    }
    selected = checkedIdsFromIssue(process.env.THALK_ISSUE_BODY);
  } else if (selectArg) {
    selected = new Set(selectArg.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean));
  } else {
    console.error('specify one of --all, --skip-all, --select=<ids>, or --from-issue');
    process.exit(1);
  }
  const toSend = pending.filter((v) => selected.has(sendId(v)));
  const toSkip = pending.filter((v) => !selected.has(sendId(v)));
  return { toSend, toSkip };
}

const messages = Object.fromEntries(
  site.languages.map((l) => [
    l.code,
    JSON.parse(fs.readFileSync(path.join(root, '..', 'site', 'i18n', `${l.code}.json`), 'utf8'))
  ])
);

const pending = pendingCandidates();
if (!pending.length) {
  console.log('nothing pending — no undecided syndicatable posts.');
  process.exit(0);
}

const { toSend, toSkip } = resolveSelection(pending);
console.log(`${dryRun ? '[dry-run] ' : ''}send ${toSend.length}, skip ${toSkip.length} (of ${pending.length} pending)`);

// Cache recipients per language (every post of a language shares the audience).
const recipientCache = new Map();
async function recipientsForLang(lang) {
  if (!recipientCache.has(lang)) recipientCache.set(lang, await recipientsFor(lang));
  return recipientCache.get(lang);
}

const ledgerEntries = [];
const now = () => new Date().toISOString();

for (const v of toSend) {
  const id = sendId(v);
  if (dryRun) {
    console.log(`  [dry-run] send ${id}`);
    continue;
  }

  const recipients = await recipientsForLang(v.lang);
  const t = makeT(messages[v.lang]);
  const locale = site.languages.find((l) => l.code === v.lang).locale;
  const otherLang = site.languages.find((l) => l.code !== v.lang).code;
  const rendered = { ...v, html: marked.parse(v.raw) };

  let sent = 0;
  for (const [i, email] of recipients.entries()) {
    const token = sign(email);
    const unsubscribeUrl = `${site.apiBase}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
    const setLangUrl = `${site.apiBase}/setLanguage?email=${encodeURIComponent(email)}&token=${token}&lang=${otherLang}`;
    const emailCtx = { t, locale, v: rendered, lang: v.lang, unsubscribeUrl, setLangUrl };
    const html = newsletterEmail(emailCtx);
    const text = newsletterText(emailCtx);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: site.newsletterFrom,
        to: email,
        reply_to: site.email,
        subject: `${t('newsletter.subject_prefix')} ${v.title}`,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          // RFC 8058 one-click unsubscribe — the unsubscribe function reads the
          // token from the URL query, so the provider's POST works unchanged.
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      })
    });
    if (!resp.ok) {
      // Identify the failure by position, never by address: this runs in CI on a
      // public repo, so anything reaching stdout/stderr is world-readable and
      // subscriber addresses are not maskable the way registered secrets are.
      console.error(`send failed for recipient ${i + 1}/${recipients.length}: ${resp.status} ${redact(await resp.text())}`);
      continue;
    }
    sent++;
    await new Promise((r) => setTimeout(r, 500)); // conservative pacing under Resend's rate limit
  }

  // Record per post right after it completes, so a mid-batch crash can at worst
  // resend the one post in flight, not the whole run.
  const entry = { key: v.key, lang: v.lang, hash: v.bodyHash, status: 'sent', at: now(), recipients: sent };
  appendLedger([entry]);
  ledgerEntries.push(entry);
  console.log(`  sent ${id} to ${sent}/${recipients.length} subscriber(s)`);
}

for (const v of toSkip) {
  const entry = { key: v.key, lang: v.lang, hash: v.bodyHash, status: 'skipped', at: now() };
  if (dryRun) {
    console.log(`  [dry-run] skip ${sendId(v)}`);
    continue;
  }
  appendLedger([entry]);
  ledgerEntries.push(entry);
  console.log(`  skipped ${sendId(v)}`);
}

if (!dryRun && ledgerEntries.length) {
  console.log(`\nappended ${ledgerEntries.length} decision(s) to newsletter/sent.jsonl — commit it to record them.`);
}
