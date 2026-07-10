// Send newsletter email for any post version marked `syndicate: [email]` that
// hasn't been sent yet (tracked by content hash via the newsletterRecipients/
// newsletterMarkSent Cloud Functions, so re-running is idempotent — this is
// meant to run on every push).
//
//   node scripts/send-newsletter.mjs [--dry-run] [--force=post:<key>:<lang>]
//
// No Firestore credential here on purpose: subscriber data is only reachable
// through the two admin-authenticated functions (THALK_ADMIN_SECRET), same as
// unsubscribe/setLanguage are the only path for readers. Those two are also
// IAM-restricted to the thalk-newsletter-invoker service account (not
// allUsers) since they can return the whole subscriber list for a language —
// GOOGLE_APPLICATION_CREDENTIALS must point at that service account's key.
// Sending also needs RESEND_API_KEY and THALK_LINK_SECRET (both skippable
// with --dry-run; GOOGLE_APPLICATION_CREDENTIALS and THALK_ADMIN_SECRET are not).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { GoogleAuth } from 'google-auth-library';
import site from '../site/config.mjs';
import { makeT, hashBody } from '../site/util.mjs';
import { newsletterEmail } from '../site/templates.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(root, '..', 'site', 'content');

const dryRun = process.argv.includes('--dry-run');
const forceArg = process.argv.find((a) => a.startsWith('--force='));
const force = forceArg ? forceArg.slice('--force='.length) : null;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const LINK_SECRET = process.env.THALK_LINK_SECRET;
const ADMIN_SECRET = process.env.THALK_ADMIN_SECRET;
if (!ADMIN_SECRET) {
  console.error('THALK_ADMIN_SECRET is required');
  process.exit(1);
}
if (!dryRun && (!RESEND_API_KEY || !LINK_SECRET)) {
  console.error('RESEND_API_KEY and THALK_LINK_SECRET are required (unless --dry-run)');
  process.exit(1);
}

function sign(email) {
  return crypto.createHmac('sha256', LINK_SECRET).update(email).digest('hex').slice(0, 32);
}

const auth = new GoogleAuth();
async function callFunction(name, body) {
  const url = `${site.apiBase}/${name}`;
  const idClient = await auth.getIdTokenClient(url);
  // getRequestHeaders() returns a Fetch Headers instance, not a plain object —
  // spreading it drops every entry, so build a real Headers to add to instead.
  const headers = new Headers(await idClient.getRequestHeaders(url));
  headers.set('x-thalk-admin-secret', ADMIN_SECRET);
  headers.set('Content-Type', 'application/json');
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${name} failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

const messages = Object.fromEntries(
  site.languages.map((l) => [
    l.code,
    JSON.parse(fs.readFileSync(path.join(root, '..', 'site', 'i18n', `${l.code}.json`), 'utf8'))
  ])
);

// Only what sending needs — not build.mjs's loadDir, which is entangled with
// output-path/registry logic this script doesn't touch.
function loadPosts(lang) {
  const dir = path.join(contentDir, lang, 'posts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const key = data.key || f.replace(/\.md$/, '');
      return {
        key,
        lang,
        title: data.title,
        date: new Date(data.date),
        draft: !!data.draft,
        syndicate: data.syndicate || [],
        path: `/${lang}/posts/${key}/`,
        html: marked.parse(content),
        bodyHash: hashBody(content)
      };
    });
}

const candidates = site.languages
  .flatMap((l) => loadPosts(l.code))
  .filter((v) => !v.draft && v.syndicate.includes('email'));

if (!candidates.length) console.log('no post versions marked syndicate: [email]');

for (const v of candidates) {
  const sendId = `post:${v.key}:${v.lang}`;
  const forced = force === sendId;

  const { alreadySent, recipients } = await callFunction('newsletterRecipients', {
    sendId,
    bodyHash: v.bodyHash,
    lang: v.lang,
    force: forced
  });
  if (alreadySent) {
    console.log(`skip ${sendId} — already sent (unchanged)`);
    continue;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}${sendId} → ${recipients.length} recipient(s)`);
  if (dryRun) continue;

  const t = makeT(messages[v.lang]);
  const locale = site.languages.find((l) => l.code === v.lang).locale;
  const otherLang = site.languages.find((l) => l.code !== v.lang).code;

  let sent = 0;
  for (const email of recipients) {
    const token = sign(email);
    const unsubscribeUrl = `${site.apiBase}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
    const setLangUrl = `${site.apiBase}/setLanguage?email=${encodeURIComponent(email)}&token=${token}&lang=${otherLang}`;
    const html = newsletterEmail({ t, locale, v, lang: v.lang, unsubscribeUrl, setLangUrl });

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: site.newsletterFrom,
        to: email,
        subject: v.title,
        html,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` }
      })
    });
    if (!resp.ok) {
      console.error(`send failed for ${email}: ${resp.status} ${await resp.text()}`);
      continue;
    }
    sent++;
    await new Promise((r) => setTimeout(r, 500)); // conservative pacing under Resend's rate limit
  }

  await callFunction('newsletterMarkSent', { sendId, bodyHash: v.bodyHash, recipientCount: sent });
  console.log(`sent ${sendId} to ${sent}/${recipients.length} subscriber(s)`);
}
