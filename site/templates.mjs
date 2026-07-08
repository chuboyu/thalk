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
    <a href="/subscribe/">subscribe</a>
    <a href="/support/">support</a>
  </nav>
</header>
<main>
${content}
</main>
<footer>
  <p>© ${new Date().getFullYear()} ${esc(site.author)} · <a href="/rss.xml">rss</a></p>
</footer>
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
    content: `<ul class="posts">\n${items}\n</ul>`
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

// Form components appended to pages that declare `form: subscribe|support`
// in front matter. The hidden "website" field is a spam honeypot.
function emailForm({ id, endpoint, buttonLabel, withNote }) {
  return `<form class="signup" id="${id}" data-endpoint="${site.apiBase}/${endpoint}">
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <label>email <input type="email" name="email" required placeholder="you@example.com"></label>
${withNote ? '  <label>anything you want to say (optional) <textarea name="note" rows="3" maxlength="2000"></textarea></label>\n' : ''}  <button type="submit">${buttonLabel}</button>
  <p class="form-status" role="status"></p>
</form>
<script>
(function () {
  var f = document.getElementById('${id}');
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
</script>`;
}

const forms = {
  subscribe: emailForm({
    id: 'subscribe-form',
    endpoint: 'subscribe',
    buttonLabel: 'subscribe'
  }),
  support: emailForm({
    id: 'support-form',
    endpoint: 'supportLead',
    buttonLabel: 'keep me posted',
    withNote: true
  })
};
