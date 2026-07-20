// Draft scaffolder. Copies templates/post.<lang>.md into
// site/content/<lang>/posts/<date>-<key>.md for every requested language, with
// `key`, `lang`, `title` and `date` filled in. Everything else — including the
// explanatory comments — is left as the template wrote it, so the front matter
// stays self-documenting while you draft.
//
//   node scripts/new-post.mjs "Multiplied, not Optimized"
//   node scripts/new-post.mjs "Small Tools" --lang=en           # one language (pair with solo: true)
//   node scripts/new-post.mjs "Small Tools" --lang=en,zh,ja     # add a ja stub too
//   node scripts/new-post.mjs "Small Tools" --key=small-tools --date=2026-08-01
//   node scripts/new-post.mjs "Small Tools" --force             # overwrite existing files
//
// Defaults: --lang is config.requiredLangs (en, zh), --date is today, --key is
// the title slugified. A language without its own template falls back to the
// defaultLang template with `lang:` rewritten. Existing files are never
// clobbered without --force.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import site from '../site/config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(root, '..', 'templates');
const contentDir = path.join(root, '..', 'site', 'content');

const args = process.argv.slice(2);
const force = args.includes('--force');
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const title = args.find((a) => !a.startsWith('--'));
if (!title) {
  console.error('Usage: node scripts/new-post.mjs "Post Title" [--key=slug] [--lang=en,zh] [--date=YYYY-MM-DD] [--force]');
  process.exit(1);
}

// Slug: ASCII words only. Non-Latin titles collapse to nothing, so require --key there.
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const key = flag('key') || slugify(title);
if (!key) {
  console.error(`✗ could not derive a url slug from "${title}" — pass --key=some-slug`);
  process.exit(1);
}

const date = flag('date') || new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`✗ --date must be YYYY-MM-DD, got "${date}"`);
  process.exit(1);
}

const known = site.languages.map((l) => l.code);
const langs = (flag('lang') || site.requiredLangs.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const unknown = langs.filter((l) => !known.includes(l));
if (unknown.length) {
  console.error(`✗ unknown language(s) [${unknown.join(', ')}] — config.languages has [${known.join(', ')}]`);
  process.exit(1);
}

// Rewrite one front-matter field, keeping any trailing `# comment` intact.
function setField(fm, field, value) {
  const re = new RegExp(`^(${field}:)([^#\\n]*)(#.*)?$`, 'm');
  if (!re.test(fm)) return `${fm}\n${field}: ${value}`;
  return fm.replace(re, (_, head, mid, comment) => {
    const pad = ' '.repeat(Math.max(1, mid.length - String(value).length));
    return comment ? `${head} ${value}${pad}${comment}` : `${head} ${value}`;
  });
}

const written = [];
for (const lang of langs) {
  let templatePath = path.join(templateDir, `post.${lang}.md`);
  if (!fs.existsSync(templatePath)) templatePath = path.join(templateDir, `post.${site.defaultLang}.md`);
  if (!fs.existsSync(templatePath)) {
    console.error(`✗ no template for "${lang}" and no fallback at templates/post.${site.defaultLang}.md`);
    process.exit(1);
  }

  const dest = path.join(contentDir, lang, 'posts', `${date}-${key}.md`);
  if (fs.existsSync(dest) && !force) {
    console.error(`✗ ${path.relative(process.cwd(), dest)} already exists — pass --force to overwrite`);
    process.exit(1);
  }

  const raw = fs.readFileSync(templatePath, 'utf8');
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) {
    console.error(`✗ ${path.relative(process.cwd(), templatePath)} has no front matter block`);
    process.exit(1);
  }

  let fm = parts[1];
  fm = setField(fm, 'key', key);
  fm = setField(fm, 'lang', lang);
  fm = setField(fm, 'title', `"${title.replace(/"/g, '\\"')}"`);
  fm = setField(fm, 'date', date);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `---${fm}---${parts.slice(2).join('---')}`);
  written.push(dest);
}

console.log(`✓ drafted "${title}" (key: ${key}, date: ${date})\n`);
for (const f of written) console.log(`  ${path.relative(path.join(root, '..'), f)}`);
console.log(`\nNext: write, then \`npm run serve\` to preview. Flip \`draft: false\` to publish.`);
if (langs.length < site.requiredLangs.length)
  console.log(`Note: config.requiredLangs is [${site.requiredLangs.join(', ')}] — mark \`solo: true\` or add the rest, or \`npm run check\` will fail.`);
