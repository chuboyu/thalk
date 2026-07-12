import site from './config.mjs';

export function esc(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function fmtDate(d, locale) {
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

const byCode = Object.fromEntries(site.languages.map((l) => [l.code, l]));

// ── Subscribe widget ────────────────────────────────────────────────────────
// Three variants sharing one form and one script (in base):
//  - inline: input row that flows with the page; remembers the subscribed email
//    in localStorage and collapses to "<email> already subscribed ✓" (click to reopen).
//  - card: same behavior, framed as a standalone bordered card with a title.
//  - nav: a compact button in the header that always expands to a fresh input.
// Display text comes from the page's message catalog; per-instance overrides
// may still be passed via `text`.
export function subscribeWidget(t, variant = 'inline', text = {}) {
  const c = {
    title: t('sub.title'),
    button: t('sub.button'),
    cta: t('sub.cta'),
    placeholder: t('sub.placeholder'),
    lead: t('sub.lead'),
    ...text
  };
  const form = `<form class="sub-form" hidden>
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="sub-hp">
    <input type="email" name="email" required placeholder="${esc(c.placeholder)}" aria-label="email">
    <button type="submit">${esc(c.button)}</button>
  </form>
  <p class="sub-status" title="${esc(t('sub.change_hint'))}" hidden></p>
  <p class="sub-error" role="alert" hidden></p>`;
  if (variant === 'nav')
    return `<div class="sub sub-nav" data-variant="nav"><button type="button" class="sub-cta">${esc(c.cta)}</button>${form}</div>`;
  if (variant === 'card')
    return `<div class="sub sub-card" data-variant="card"><p class="sub-title">${esc(c.title)}</p><p class="sub-lead">${esc(c.lead)}</p>${form}</div>`;
  return `<div class="sub sub-inline" data-variant="inline">${form}</div>`;
}

function widgetScript(t) {
  // Messages baked in per language; the token @@E@@ marks the email slot.
  const msg = {
    already: t('sub.already', { email: '@@E@@' }),
    thanks: t('sub.thanks', { email: '@@E@@' }),
    error: t('sub.error')
  };
  return `<script>
(function () {
  var KEY = 'thalk.subscribed';
  var API = '${site.apiBase}/subscribe';
  var LANG = document.body.dataset.lang;
  var M = ${JSON.stringify(msg)};
  function fill(tpl, email) { return tpl.replace('@@E@@', email); }
  document.querySelectorAll('.sub').forEach(function (w) {
    var form = w.querySelector('.sub-form');
    var status = w.querySelector('.sub-status');
    var error = w.querySelector('.sub-error');
    var cta = w.querySelector('.sub-cta');
    var email = form.querySelector('[name=email]');
    var btn = form.querySelector('button[type=submit]');
    var label = btn.textContent;

    function open(prefill) {
      if (cta) cta.hidden = true;
      status.hidden = true;
      form.hidden = false;
      email.value = prefill || '';
      email.focus();
    }
    function done(text) {
      form.hidden = true;
      error.hidden = true;
      status.textContent = text;
      status.hidden = false;
    }

    status.addEventListener('click', function () {
      open(w.dataset.variant === 'nav' ? '' : localStorage.getItem(KEY));
    });

    if (w.dataset.variant === 'nav') {
      cta.addEventListener('click', function () { open(''); });
    } else if (localStorage.getItem(KEY)) {
      done(fill(M.already, localStorage.getItem(KEY)));
    } else {
      form.hidden = false;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = email.value.trim();
      btn.disabled = true;
      btn.textContent = '\\u2026';
      error.hidden = true;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, website: form.website.value, lang: LANG })
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        localStorage.setItem(KEY, value);
        done(fill(M.thanks, value));
      }).catch(function () {
        error.textContent = M.error;
        error.hidden = false;
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
    });
  });
})();
</script>`;
}

// ── Cross-language components ────────────────────────────────────────────────
// Per-content "also in" strip (point 6): static links to the sibling language
// versions that actually exist for this piece. Clicking also records the choice
// locally, so a language picked while reading persists on return.
function langStrip(t, siblings, currentLang) {
  const others = siblings.filter((s) => s.lang !== currentLang);
  if (!others.length) return '';
  const links = others
    .map((s) => `<a href="${s.path}" data-setlang="${s.lang}">${esc(byCode[s.lang].label)}</a>`)
    .join(' · ');
  return `<p class="langstrip">${esc(t('content.available_in'))} ${links}</p>`;
}

// Index-page language selector (point 7): choose the site language; the choice
// persists in localStorage, locally only, and navigates to that language's home.
function langSelector(t, currentLang) {
  const buttons = site.languages
    .map(
      (l) =>
        `<a href="/${l.code}/" data-setlang="${l.code}"${l.code === currentLang ? ' aria-current="true"' : ''}>${esc(l.label)}</a>`
    )
    .join('');
  return `<nav class="langselect" aria-label="${esc(t('langselect.label'))}">${buttons}</nav>`;
}

// One tiny listener powers every data-setlang link on the page.
const setlangScript = `<script>
document.querySelectorAll('[data-setlang]').forEach(function (a) {
  a.addEventListener('click', function () {
    try { localStorage.setItem('thalk.lang', a.dataset.setlang); } catch (e) {}
  });
});
</script>`;

// Provenance banner shown on machine/reviewed pages (transparency layer).
function provenanceBanner(t, v) {
  if (!v || v.provenance === 'original') return '';
  const key = v.provenance === 'reviewed' ? 'banner.reviewed' : 'banner.machine';
  const date =
    v.translatedAt instanceof Date ? v.translatedAt.toISOString().slice(0, 10) : v.translatedAt || '';
  const line = t(key, { base: t('lang.' + v.base), model: joinList(t, v.model) || 'AI', date });
  const origin = byCode[v.base]
    ? ` <a href="/${v.base}/${v.kind === 'post' ? 'posts/' : ''}${v.key}/">${esc(t('banner.read_original'))}</a>`
    : '';
  const report = site.email
    ? ` · <a href="mailto:${site.email}?subject=translation%20error%20(${v.lang}/${v.key})">${esc(t('banner.report_error'))}</a>`
    : '';
  const stale = v.stale ? `<br><span class="prov-stale">${esc(t('banner.stale'))}</span>` : '';
  return `<aside class="prov" role="note"><span>${esc(line)}</span>${origin}${report}${stale}</aside>`;
}

// Join a list of names with a localized conjunction: [a] → "a",
// [a,b] → "a and b", [a,b,c] → "a, b and c".
function joinList(t, items) {
  if (!items || !items.length) return '';
  if (items.length === 1) return items[0];
  const and = t('list.and');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

// Chip row: topical tags plus an AI-authorship disclosure chip, colour-set
// apart. `authorship` is a separate axis from `provenance` (which is about
// translation-from-a-base): a post with no base is still `original`, but may be
// AI-assisted or AI-generated, and that's disclosed here.
function tagRow(t, v) {
  const chips = [];
  if (v.authorship === 'ai-generated' || v.authorship === 'ai-assisted') {
    const label = t(v.authorship === 'ai-generated' ? 'authorship.ai_generated' : 'authorship.ai_assisted');
    // Name the model(s) in a tooltip — only for `original`, where `model`
    // unambiguously means the authorship models (on machine/reviewed versions
    // `model` is the translator, already shown in the provenance banner).
    const models = v.provenance === 'original' && v.model && v.model.length ? v.model.join(', ') : '';
    const title = models ? ` title="${esc(label + ' · ' + models)}"` : '';
    chips.push(`<span class="tag tag-ai"${title}>${esc(label)}</span>`);
  }
  for (const tag of v.tags || []) {
    // Localized tag label via i18n key `tag.<name>`; falls back to the raw tag
    // when there's no translation (makeT returns the key unchanged if missing).
    const key = 'tag.' + tag;
    const label = t(key);
    chips.push(`<span class="tag">${esc(label === key ? tag : label)}</span>`);
  }
  if (!chips.length) return '';
  return `<p class="tags">${chips.join('')}</p>`;
}

// ── Page skeleton ────────────────────────────────────────────────────────────
export function base(ctx) {
  const { t, lang, path, title, description, content, hreflang = [] } = ctx;
  const L = byCode[lang];
  const fullTitle = ctx.isHome ? site.title : `${title} · ${site.title}`;
  const alts = hreflang
    .map((h) => `<link rel="alternate" hreflang="${h.hreflang}" href="${site.url}${h.path}">`)
    .join('\n');
  return `<!doctype html>
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || t('site.description'))}">
<link rel="canonical" href="${site.url}${path}">
${alts}
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${site.url}/${lang}/rss.xml">
<link rel="stylesheet" href="/style.css">
</head>
<body data-lang="${lang}">
<header>
  <a class="brand" href="/${lang}/">${esc(site.title)}</a>
  <nav>
    <a href="/${lang}/about/">${esc(t('nav.about'))}</a>
    <a href="/${lang}/support/">${esc(t('nav.support'))}</a>
    ${subscribeWidget(t, 'nav')}
  </nav>
</header>
<main>
${content}
</main>
<footer>
  <p>© ${new Date().getFullYear()} ${esc(site.author)} · <a href="/${lang}/rss.xml">${esc(t('footer.rss'))}</a></p>
</footer>
${widgetScript(t)}
${setlangScript}
</body>
</html>
`;
}

export function index(ctx) {
  const { t, lang, locale, posts } = ctx;
  const items = posts
    .map(
      (p) => `  <li>
    <time datetime="${p.date.toISOString().slice(0, 10)}">${fmtDate(p.date, locale)}</time>
    <a href="${p.path}">${esc(p.title)}</a>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
  </li>`
    )
    .join('\n');
  const card = subscribeWidget(t, 'card', { title: t('sub.card_title'), lead: t('sub.card_lead') });
  return base({
    ...ctx,
    isHome: true,
    title: site.title,
    description: t('site.description'),
    content: `${langSelector(t, lang)}\n<ul class="posts">\n${items}\n</ul>\n${card}`
  });
}

export function post(ctx) {
  const { t, locale, v, siblings } = ctx;
  return base({
    ...ctx,
    title: v.title,
    description: v.description,
    content: `<article>
${provenanceBanner(t, v)}
<h1>${esc(v.title)}</h1>
<p class="meta"><time datetime="${v.date.toISOString().slice(0, 10)}">${fmtDate(v.date, locale)}</time></p>
${tagRow(t, v)}
${langStrip(t, siblings, v.lang)}
${v.html}
${subscribeWidget(t, 'inline')}
</article>`
  });
}

export function page(ctx) {
  const { t, v, siblings } = ctx;
  const form = v.form ? supportForm(t) : '';
  return base({
    ...ctx,
    title: v.title,
    description: v.description,
    content: `<article>
${provenanceBanner(t, v)}
<h1>${esc(v.title)}</h1>
${langStrip(t, siblings, v.lang)}
${v.html}
${form}
</article>`
  });
}

// ── Newsletter email ────────────────────────────────────────────────────────
// Plain inline-styled HTML (email clients ignore <style> blocks and external
// CSS unpredictably) rendered by scripts/send-newsletter.mjs, one per post
// version. unsubscribeUrl/setLangUrl are per-recipient, built by the script.
export function newsletterEmail(ctx) {
  const { t, locale, v, lang, unsubscribeUrl, setLangUrl } = ctx;
  const L = byCode[lang];
  return `<!doctype html>
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(v.title)}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; color: #222;">
<p style="margin: 0 0 1.5rem;"><a href="${site.url}/${lang}/" style="color: #222; text-decoration: none; font-weight: 600;">${esc(site.title)}</a></p>
<h1 style="font-size: 1.4rem; margin: 0 0 .25rem;">${esc(v.title)}</h1>
<p style="margin: 0 0 1.5rem; color: #666; font-size: .9rem;">
  <time datetime="${v.date.toISOString().slice(0, 10)}">${fmtDate(v.date, locale)}</time>
  · <a href="${site.url}${v.path}" style="color: #666;">${esc(t('newsletter.view_online'))}</a>
</p>
${v.html}
<hr style="margin: 2rem 0 1rem; border: none; border-top: 1px solid #ddd;">
<p style="font-size: .85rem; color: #666;">
${esc(site.author)} · <a href="mailto:${site.email}" style="color: #666;">${esc(site.email)}</a><br>
<a href="${unsubscribeUrl}" style="color: #666;">${esc(t('newsletter.unsubscribe'))}</a>
· <a href="${setLangUrl}" style="color: #666;">${esc(t('newsletter.change_lang'))}</a>
</p>
</body>
</html>
`;
}

// Plain-text counterpart, sent as the multipart/alternative text part. A text
// part improves spam scoring and is expected of legitimate bulk mail; it also
// reads fine in text-only clients. Uses the raw markdown body as-is (markdown is
// readable as plain text).
export function newsletterText(ctx) {
  const { t, v, unsubscribeUrl } = ctx;
  return [
    v.title,
    '',
    v.raw.trim(),
    '',
    '—',
    `${t('newsletter.view_online')}: ${site.url}${v.path}`,
    `${t('newsletter.unsubscribe')}: ${unsubscribeUrl}`,
    `${site.author} · ${site.email}`,
    ''
  ].join('\n');
}

// Support lead form: separate from the subscribe widget on purpose — different
// dataset (support_leads) and it carries an optional note. Hidden "website" is a
// spam honeypot.
function supportForm(t) {
  return `<form class="signup" id="support-form" data-endpoint="${site.apiBase}/supportLead">
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <label>${esc(t('support.email'))} <input type="email" name="email" required placeholder="you@example.com"></label>
  <label>${esc(t('support.note'))} <textarea name="note" rows="3" maxlength="2000"></textarea></label>
  <button type="submit">${esc(t('support.button'))}</button>
  <p class="form-status" role="status"></p>
</form>
<script>
(function () {
  var f = document.getElementById('support-form');
  var DONE = ${JSON.stringify(t('support.done'))};
  var ERR = ${JSON.stringify(t('sub.error'))};
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var status = f.querySelector('.form-status');
    var data = Object.fromEntries(new FormData(f));
    data.lang = document.body.dataset.lang;
    status.textContent = '…';
    fetch(f.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      status.textContent = DONE;
      f.querySelector('button').disabled = true;
    }).catch(function () {
      status.textContent = ERR;
    });
  });
})();
</script>`;
}
