import crypto from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

const opts = {
  region: 'asia-east1',
  cors: ['https://thalk.chuboyu.space', /^http:\/\/localhost(:\d+)?$/],
  maxInstances: 2
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Subscriber's newsletter language — set at subscribe time, changeable via the
// setLanguage link in every newsletter send.
const ALLOWED_LANGS = new Set(['en', 'zh', 'ja']);
const DEFAULT_LANG = 'en';
const LANG_LABELS = { en: 'English', zh: '繁體中文', ja: '日本語' };
// Not imported from site/config.mjs: Firebase only bundles the `functions/`
// source directory, so anything outside it is unavailable at runtime.
const SITE_URL = 'https://thalk.chuboyu.space';
const API_BASE = 'https://asia-east1-thalk-1c092.cloudfunctions.net';

// Signs unsubscribe/setLanguage links so anyone with the link (but not the
// secret) can act on that one email address only.
const linkSecret = defineSecret('THALK_LINK_SECRET');
function sign(email) {
  return crypto.createHmac('sha256', linkSecret.value()).update(email).digest('hex').slice(0, 32);
}
function validToken(email, token) {
  if (typeof token !== 'string') return false;
  const expected = Buffer.from(sign(email));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Gates the two newsletter-sending endpoints below. Separate from linkSecret:
// that one is scoped per-email (a leak lets someone unsubscribe/switch-lang
// one address they already know); this one gates listing the whole subscriber
// list for a language, so it stays a distinct, narrower-audience secret.
//
// These two functions are ALSO IAM-restricted (invoker limited to the
// thalk-newsletter-invoker service account, not allUsers) — the app secret
// alone isn't the boundary here, unlike subscribe/unsubscribe/setLanguage.
// Because IAM enforcement consumes the standard `Authorization: Bearer
// <google-id-token>` header before a request ever reaches this code, the app
// secret travels in a separate header so the two checks don't collide.
const adminSecret = defineSecret('THALK_ADMIN_SECRET');
function isAdmin(req) {
  const given = req.get('x-thalk-admin-secret') || '';
  const expected = Buffer.from(adminSecret.value());
  const givenBuf = Buffer.from(given);
  return expected.length === givenBuf.length && crypto.timingSafeEqual(expected, givenBuf);
}

function escHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Tiny static confirmation page — these links are opened by a browser from an
// email client, so a human needs something readable, not JSON.
function htmlPage(res, status, title, body) {
  res
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} — thalk</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #222;">
${body}
<p style="margin-top: 2rem;"><a href="${SITE_URL}/">thalk.chuboyu.space</a></p>
</body>
</html>
`);
}

// Instance-local rate limit; resets on cold start, which is fine at this scale.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

function accept(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return null;
  }
  if (rateLimited(req.ip)) {
    res.status(429).json({ ok: false });
    return null;
  }
  const { email, note, website, lang } = req.body ?? {};
  // Honeypot filled → pretend success, store nothing.
  if (website) {
    res.json({ ok: true });
    return null;
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ ok: false, error: 'invalid email' });
    return null;
  }
  return {
    email: email.trim().toLowerCase(),
    note: typeof note === 'string' ? note.slice(0, 2000) : '',
    lang: ALLOWED_LANGS.has(lang) ? lang : DEFAULT_LANG
  };
}

export const subscribe = onRequest(opts, async (req, res) => {
  const input = accept(req, res);
  if (!input) return;
  const ref = db.collection('subscribers').doc(input.email);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({
      email: input.email,
      confirmed: true,
      source: 'site',
      lang: input.lang,
      createdAt: FieldValue.serverTimestamp()
    });
  }
  // Same response whether new or duplicate: no email enumeration.
  res.json({ ok: true });
});

export const supportLead = onRequest(opts, async (req, res) => {
  const input = accept(req, res);
  if (!input) return;
  await db.collection('support_leads').add({
    email: input.email,
    note: input.note,
    lang: input.lang,
    createdAt: FieldValue.serverTimestamp()
  });
  res.json({ ok: true });
});

export const unsubscribe = onRequest({ ...opts, secrets: [linkSecret] }, async (req, res) => {
  if (rateLimited(req.ip)) return htmlPage(res, 429, 'Too many requests', '<h1>Too many requests</h1>');
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || !validToken(email, req.query.token)) {
    return htmlPage(res, 400, 'Invalid link', '<h1>Invalid or expired link</h1><p>This unsubscribe link isn’t valid.</p>');
  }
  await db
    .collection('subscribers')
    .doc(email)
    .set({ unsubscribed: true, unsubscribedAt: FieldValue.serverTimestamp() }, { merge: true });
  htmlPage(
    res,
    200,
    'Unsubscribed',
    `<h1>Unsubscribed</h1><p>${escHtml(email)} has been removed from the thalk mailing list. Sorry to see you go.</p>`
  );
});

export const setLanguage = onRequest({ ...opts, secrets: [linkSecret] }, async (req, res) => {
  if (rateLimited(req.ip)) return htmlPage(res, 429, 'Too many requests', '<h1>Too many requests</h1>');
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const lang = req.query.lang;
  if (!EMAIL_RE.test(email) || !validToken(email, req.query.token)) {
    return htmlPage(res, 400, 'Invalid link', '<h1>Invalid or expired link</h1><p>This link isn’t valid.</p>');
  }
  if (!ALLOWED_LANGS.has(lang)) return htmlPage(res, 400, 'Invalid language', '<h1>Invalid language</h1>');
  await db.collection('subscribers').doc(email).set({ lang }, { merge: true });
  const switchLinks = [...ALLOWED_LANGS]
    .map(
      (l) =>
        `<a href="${API_BASE}/setLanguage?email=${encodeURIComponent(email)}&token=${sign(email)}&lang=${l}">${escHtml(LANG_LABELS[l])}</a>`
    )
    .join(' · ');
  htmlPage(
    res,
    200,
    'Language updated',
    `<h1>Language updated</h1><p>Future newsletters to ${escHtml(email)} will be sent in <strong>${escHtml(LANG_LABELS[lang])}</strong>.</p><p>Change again: ${switchLinks}</p>`
  );
});

// The only way the newsletter plan/send scripts (run locally or from CI) touch
// subscriber data — they never get their own Firestore credential, only this
// narrow, secret-gated + service-account-IAM-gated API. Firestore stays
// reachable exclusively through functions, per firestore.rules. Send-state now
// lives in the git ledger (newsletter/sent.jsonl), not Firestore, so this no
// longer tracks what was sent — it just returns the audience for a language.
//
// { lang, countOnly? } → { recipients } (addresses) or { count }.
export const newsletterRecipients = onRequest({ ...opts, secrets: [adminSecret] }, async (req, res) => {
  if (req.method !== 'POST' || !isAdmin(req)) return res.status(403).json({ ok: false });
  const { lang, countOnly } = req.body ?? {};
  if (!ALLOWED_LANGS.has(lang)) return res.status(400).json({ ok: false });
  const snap = await db.collection('subscribers').where('lang', '==', lang).get();
  const active = snap.docs.filter((d) => !d.data().unsubscribed);
  // countOnly (plan phase) moves no addresses off the server.
  if (countOnly) return res.json({ ok: true, count: active.length });
  res.json({ ok: true, recipients: active.map((d) => d.id) });
});
