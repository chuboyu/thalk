import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import site from './config.mjs';
import { makeT, hashBody } from './util.mjs';
import * as tpl from './templates.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(root, 'content');
const outDir = path.join(root, '..', 'dist');
const includeDrafts = process.argv.includes('--drafts');

const messages = Object.fromEntries(
  site.languages.map((l) => [
    l.code,
    JSON.parse(fs.readFileSync(path.join(root, 'i18n', `${l.code}.json`), 'utf8'))
  ])
);

function writePage(urlPath, html) {
  const dir = path.join(outDir, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

// ── Load every language's content into version records keyed by kind:key ─────
function loadDir(lang, kind, dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const key = data.key || f.replace(/\.md$/, '');
      const v = {
        ...data,
        lang,
        kind,
        key,
        raw: content,
        html: marked.parse(content),
        bodyHash: hashBody(content),
        provenance: data.provenance || 'original'
      };
      if (kind === 'post') {
        v.date = new Date(data.date);
        v.path = `/${lang}/posts/${key}/`;
      } else {
        v.path = `/${lang}/${key}/`;
      }
      return v;
    });
}

const registry = new Map(); // "kind:key" -> { kind, key, byLang: {lang: v} }
for (const l of site.languages) {
  const dir = path.join(contentDir, l.code);
  const versions = [
    ...loadDir(l.code, 'post', path.join(dir, 'posts')),
    ...loadDir(l.code, 'page', dir)
  ];
  for (const v of versions) {
    const id = `${v.kind}:${v.key}`;
    if (!registry.has(id)) registry.set(id, { kind: v.kind, key: v.key, byLang: {} });
    registry.get(id).byLang[v.lang] = v;
  }
}

// Resolve staleness for machine/reviewed versions against their base's body hash.
for (const group of registry.values()) {
  for (const v of Object.values(group.byLang)) {
    if (v.provenance !== 'original' && v.base) {
      const baseV = group.byLang[v.base];
      v.stale = baseV ? baseV.bodyHash !== v.baseHash : true;
    }
  }
}

// ── Render ───────────────────────────────────────────────────────────────────
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const visible = (v) => includeDrafts || !v.draft;

function siblingsOf(group) {
  return Object.values(group.byLang)
    .filter(visible)
    .map((v) => ({ lang: v.lang, path: v.path, provenance: v.provenance }));
}

// hreflang alternates: every visible language version of the same content.
function hreflangOf(group, forPath) {
  const alts = Object.values(group.byLang)
    .filter(visible)
    .map((v) => ({ hreflang: site.languages.find((l) => l.code === v.lang).hreflang, path: v.path }));
  const def = group.byLang[site.defaultLang];
  if (def && visible(def)) alts.push({ hreflang: 'x-default', path: def.path });
  return alts;
}

for (const l of site.languages) {
  const lang = l.code;
  const t = makeT(messages[lang]);
  const locale = l.locale;

  // Posts and pages for this language.
  for (const group of registry.values()) {
    const v = group.byLang[lang];
    if (!v || !visible(v)) continue;
    const ctx = { t, lang, locale, v, siblings: siblingsOf(group), hreflang: hreflangOf(group) };
    writePage(v.path, v.kind === 'post' ? tpl.post(ctx) : tpl.page(ctx));
  }

  // Index (only posts present in this language).
  const posts = [...registry.values()]
    .filter((g) => g.kind === 'post')
    .map((g) => g.byLang[lang])
    .filter((v) => v && visible(v))
    .sort((a, b) => b.date - a.date);
  const homeGroups = { byLang: Object.fromEntries(site.languages.map((x) => [x.code, { path: `/${x.code}/` }])) };
  const homeHreflang = site.languages
    .map((x) => ({ hreflang: x.hreflang, path: `/${x.code}/` }))
    .concat([{ hreflang: 'x-default', path: `/${site.defaultLang}/` }]);
  writePage(`/${lang}/`, tpl.index({ t, lang, locale, posts, path: `/${lang}/`, hreflang: homeHreflang }));

  // Per-language RSS.
  writeRss(lang, posts);
}

// ── RSS ──────────────────────────────────────────────────────────────────────
function writeRss(lang, posts) {
  const xml = (s) => tpl.esc(s).replaceAll("'", '&apos;');
  const absolutize = (html) => html.replaceAll(/(href|src)="\//g, `$1="${site.url}/`);
  const L = site.languages.find((l) => l.code === lang);
  const t = makeT(messages[lang]);
  const items = posts
    .map(
      (p) => `  <item>
    <title>${xml(p.title)}</title>
    <link>${site.url}${p.path}</link>
    <guid>${site.url}${p.path}</guid>
    <pubDate>${p.date.toUTCString()}</pubDate>
    <description>${xml(absolutize(p.html))}</description>
  </item>`
    )
    .join('\n');
  fs.writeFileSync(
    path.join(outDir, lang, 'rss.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xml(site.title)}</title>
  <link>${site.url}/${lang}/</link>
  <description>${xml(t('site.description'))}</description>
  <language>${L.htmlLang}</language>
  <atom:link href="${site.url}/${lang}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`
  );
}

// ── Root language detector (symmetric routing: no unprefixed page) ───────────
const codes = site.languages.map((l) => l.code);
const rootAlts = site.languages
  .map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${site.url}/${l.code}/">`)
  .join('\n');
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html>
<html lang="${site.languages.find((l) => l.code === site.defaultLang).htmlLang}">
<head>
<meta charset="utf-8">
<title>${tpl.esc(site.title)}</title>
${rootAlts}
<link rel="alternate" hreflang="x-default" href="${site.url}/${site.defaultLang}/">
<script>
(function () {
  var langs = ${JSON.stringify(codes)};
  var pick = null;
  try { pick = localStorage.getItem('thalk.lang'); } catch (e) {}
  if (langs.indexOf(pick) < 0) {
    var n = (navigator.language || '').toLowerCase();
    pick = n.indexOf('zh') === 0 ? 'zh' : '${site.defaultLang}';
  }
  location.replace('/' + pick + '/');
})();
</script>
</head>
<body><a href="/${site.defaultLang}/">Enter</a></body>
</html>
`
);

// Static assets → dist root.
fs.cpSync(path.join(root, 'static'), outDir, { recursive: true });

// Staleness warnings.
let stale = 0;
for (const group of registry.values())
  for (const v of Object.values(group.byLang)) if (v.stale) { stale++; console.warn(`  stale: ${v.path} (base changed since translation)`); }

const total = [...registry.values()].reduce((n, g) => n + Object.values(g.byLang).filter(visible).length, 0);
console.log(
  `built ${total} page(s) across ${site.languages.length} language(s) → ${path.relative(process.cwd(), outDir)}` +
    (includeDrafts ? ' (drafts included)' : '') +
    (stale ? ` — ${stale} stale translation(s)` : '')
);
