import { onRequest } from 'firebase-functions/v2/https';
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
// Subscriber's newsletter language (stored now; per-language sending is phase 2).
const ALLOWED_LANGS = new Set(['en', 'zh']);
const DEFAULT_LANG = 'en';

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
