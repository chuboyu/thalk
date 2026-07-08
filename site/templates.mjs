import site from './config.mjs';

export function esc(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Subscribe widget. Three variants sharing one form and one script (in base):
//  - inline: input row that flows with the page; remembers the subscribed email
//    in localStorage and collapses to "<email> already subscribed ✓" (click to reopen).
//  - card: same behavior as inline, but framed as a standalone bordered card
//    with its own title — for placements that shouldn't align with running text.
//  - nav: a compact button in the header that always expands to a fresh input.
// All display text is overridable per instance via the second argument.
export function subscribeWidget(variant = 'inline', text = {}) {
  const t = {
    lead: 'get new posts by email',
    title: 'subscribe',
    button: 'subscribe',
    cta: 'subscribe',
    placeholder: 'you@example.com',
    ...text
  };
  const form = `<form class="sub-form" hidden>
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="sub-hp">
    <input type="email" name="email" required placeholder="${esc(t.placeholder)}" aria-label="email">
    <button type="submit">${esc(t.button)}</button>
  </form>
  <p class="sub-status" title="click to change" hidden></p>
  <p class="sub-error" role="alert" hidden></p>`;
  if (variant === 'nav')
    return `<div class="sub sub-nav" data-variant="nav"><button type="button" class="sub-cta">${esc(t.cta)}</button>${form}</div>`;
  if (variant === 'card')
    return `<div class="sub sub-card" data-variant="card"><p class="sub-title">${esc(t.title)}</p><p class="sub-lead">${esc(t.lead)}</p>${form}</div>`;
  return `<div class="sub sub-inline" data-variant="inline">${form}</div>`;
}

const widgetScript = `<script>
(function () {
  var KEY = 'thalk.subscribed';
  var API = '${site.apiBase}/subscribe';
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
      done(localStorage.getItem(KEY) + ' already subscribed \\u2713');
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
        body: JSON.stringify({ email: value, website: form.website.value })
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        localStorage.setItem(KEY, value);
        done(value + ' subscribed \\u2713 \\u2014 thank you');
      }).catch(function () {
        error.textContent = 'something went wrong; please try again later.';
        error.hidden = false;
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
    });
  });
})();
</script>`;

export function base({ title, description, path, content }) {
  const fullTitle = path === '/' ? site.title : `${title} · ${site.title}`;
  return `<!doctype html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="canonical" href="${site.url}${path}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${site.url}/rss.xml">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="brand" href="/">${esc(site.title)}</a>
  <nav>
    <a href="/about/">about</a>
    <a href="/support/">support</a>
    ${subscribeWidget('nav')}
  </nav>
</header>
<main>
${content}
</main>
<footer>
  <p>© ${new Date().getFullYear()} ${esc(site.author)} · <a href="/rss.xml">rss</a></p>
</footer>
${widgetScript}
</body>
</html>
`;
}

export function index(posts) {
  const items = posts
    .map(
      (p) => `  <li>
    <time datetime="${p.date.toISOString().slice(0, 10)}">${fmtDate(p.date)}</time>
    <a href="${p.path}">${esc(p.title)}</a>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
  </li>`
    )
    .join('\n');
  return base({
    title: site.title,
    description: site.description,
    path: '/',
    content: `<ul class="posts">\n${items}\n</ul> 
      ${subscribeWidget('card', 
        {
          title:'Keep in touch', 
          lead:"If you like my thoughts and works, join the mailing list for the latest posts!"
        }
      )}`
  });
}

export function post(p) {
  return base({
    title: p.title,
    description: p.description,
    path: p.path,
    content: `<article>
<h1>${esc(p.title)}</h1>
<p class="meta"><time datetime="${p.date.toISOString().slice(0, 10)}">${fmtDate(p.date)}</time></p>
${p.html}
${subscribeWidget('inline')}
</article>`
  });
}

export function page(p) {
  const form = p.form ? forms[p.form] ?? '' : '';
  return base({
    title: p.title,
    description: p.description,
    path: p.path,
    content: `<article>
<h1>${esc(p.title)}</h1>
${p.html}
${form}
</article>`
  });
}

// Support lead form: separate from the subscribe widget on purpose —
// different dataset (support_leads) and it carries an optional note.
// The hidden "website" field is a spam honeypot.
const forms = {
  support: `<form class="signup" id="support-form" data-endpoint="${site.apiBase}/supportLead">
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <label>email <input type="email" name="email" required placeholder="you@example.com"></label>
  <label>anything you want to say (optional) <textarea name="note" rows="3" maxlength="2000"></textarea></label>
  <button type="submit">keep me posted</button>
  <p class="form-status" role="status"></p>
</form>
<script>
(function () {
  var f = document.getElementById('support-form');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var status = f.querySelector('.form-status');
    var data = Object.fromEntries(new FormData(f));
    status.textContent = '…';
    fetch(f.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      status.textContent = 'done — thank you.';
      f.querySelector('button').disabled = true;
    }).catch(function () {
      status.textContent = 'something went wrong; please try again later.';
    });
  });
})();
</script>`
};
