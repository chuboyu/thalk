import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import site from './config.mjs';
import * as t from './templates.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(root, 'content');
const outDir = path.join(root, '..', 'dist');
const includeDrafts = process.argv.includes('--drafts');

function readMarkdown(file) {
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  return { ...data, html: marked.parse(content), raw: content };
}

function writePage(urlPath, html) {
  const dir = path.join(outDir, urlPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Posts
const postsDir = path.join(contentDir, 'posts');
const posts = fs
  .readdirSync(postsDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const p = readMarkdown(path.join(postsDir, f));
    const slug = f.replace(/\.md$/, '');
    return { ...p, slug, date: new Date(p.date), path: `/posts/${slug}/` };
  })
  .filter((p) => includeDrafts || !p.draft)
  .sort((a, b) => b.date - a.date);

for (const p of posts) writePage(p.path, t.post(p));

// Standalone pages (about, subscribe, support, …)
for (const f of fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'))) {
  const p = readMarkdown(path.join(contentDir, f));
  const slug = f.replace(/\.md$/, '');
  writePage(`/${slug}/`, t.page({ ...p, path: `/${slug}/` }));
}

// Index
fs.writeFileSync(path.join(outDir, 'index.html'), t.index(posts));

// RSS (full content; escaping is the only subtlety)
const xml = (s) => t.esc(s).replaceAll("'", '&apos;');
// Feed readers can't resolve relative links, so make them absolute.
const absolutize = (html) => html.replaceAll(/(href|src)="\//g, `$1="${site.url}/`);
const rssItems = posts
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
  path.join(outDir, 'rss.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xml(site.title)}</title>
  <link>${site.url}</link>
  <description>${xml(site.description)}</description>
  <language>${site.lang}</language>
  <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml"/>
${rssItems}
</channel>
</rss>
`
);

// Static assets → dist root
fs.cpSync(path.join(root, 'static'), outDir, { recursive: true });

console.log(
  `built ${posts.length} post(s) → ${path.relative(process.cwd(), outDir)}` +
    (includeDrafts ? ' (drafts included)' : '')
);
