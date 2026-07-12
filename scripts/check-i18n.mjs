// Pre-publish language-coverage gate.
// A translation group must have every language in config.requiredLangs, unless
// it is deliberately single-language — marked by `solo: true` on a version.
// Exit 1 on any gap so CI (and you, before publishing) catch half-translated content.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import site from '../site/config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(root, '..', 'site', 'content');

function load(lang, kind, dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { lang, kind, key: data.key || f.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''), draft: !!data.draft, solo: !!data.solo };
    });
}

const groups = new Map();
for (const l of site.languages) {
  const dir = path.join(contentDir, l.code);
  for (const v of [...load(l.code, 'post', path.join(dir, 'posts')), ...load(l.code, 'page', dir)]) {
    const id = `${v.kind}:${v.key}`;
    if (!groups.has(id)) groups.set(id, { id, langs: {}, solo: false });
    const g = groups.get(id);
    g.langs[v.lang] = v;
    if (v.solo) g.solo = true;
  }
}

const problems = [];
for (const g of groups.values()) {
  if (g.solo) continue;
  const missing = site.requiredLangs.filter((code) => !g.langs[code]);
  if (missing.length) problems.push({ id: g.id, missing, have: Object.keys(g.langs) });
}

if (problems.length) {
  console.error('✗ i18n coverage — these groups are missing required languages:\n');
  for (const p of problems)
    console.error(`  ${p.id}  has [${p.have.join(', ')}], missing [${p.missing.join(', ')}]`);
  console.error(
    `\nExpected languages: ${site.requiredLangs.join(', ')}.` +
      `\nEither add the missing version(s), or mark an existing version \`solo: true\` to publish it intentionally single-language.`
  );
  process.exit(1);
}

console.log(`✓ i18n coverage: ${groups.size} group(s), all complete for [${site.requiredLangs.join(', ')}] (or marked solo).`);
