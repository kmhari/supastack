/**
 * Copies the repo's docs/*.md into website/docs/ and writes website/docs/index.json
 * ({ slug, title }) for the in-SPA docs renderer. Run by the Pages workflow before
 * upload, and locally before `python3 -m http.server` to preview the docs route.
 *
 * website/docs/ is generated output (gitignored) — docs/ is the single source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'docs');
const outDir = path.join(here, 'docs');

fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));

const items = files
  .map((f) => {
    const slug = f.replace(/\.md$/, '');
    const md = fs.readFileSync(path.join(srcDir, f), 'utf8');
    fs.writeFileSync(path.join(outDir, f), md);
    const m = md.match(/^#\s+(.+)$/m);
    return { slug, title: m ? m[1].trim() : slug };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(items, null, 2) + '\n');
console.log(`synced ${items.length} docs → website/docs/`);
