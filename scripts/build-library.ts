// Build-time indexer: reads assets/*.svg, parses each file, extracts its colors
// and writes src/data/library.json. The SVG files themselves are copied
// unchanged to public/library/ and fetched by the app at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../src/data/catalog.json';
import { extractColors, parseSvg } from '../src/core/svg';
import type { Library, LibraryObject, SizeSet, Variant } from '../src/core/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT_SVG = path.join(ROOT, 'public', 'library');
const OUT_JSON = path.join(ROOT, 'src', 'data', 'library.json');

const CAT = catalog as Record<string, { ru: string; en: string; tags: string[] }>;
const FILE_RE = /^([LS])_(main|bg)_([a-z0-9-]+)\.svg$/;

fs.rmSync(OUT_SVG, { recursive: true, force: true });
fs.mkdirSync(OUT_SVG, { recursive: true });

const objects: LibraryObject[] = [];
for (const file of fs.readdirSync(ASSETS).sort()) {
  const m = file.match(FILE_RE);
  if (!m) continue;
  const [, size, type, key] = m as unknown as [string, SizeSet, Variant, string];
  const text = fs.readFileSync(path.join(ASSETS, file), 'utf8');
  const svg = parseSvg(text);
  const cat = CAT[key] ?? { ru: key, en: key, tags: [key] };
  const variantTags = type === 'main' ? ['главный', 'цветной', 'main'] : ['фоновый', 'монохром', 'background'];
  objects.push({
    id: file.replace(/\.svg$/, ''),
    key,
    name: cat.ru,
    nameEn: cat.en,
    size,
    type,
    file,
    width: svg.viewBox[2],
    height: svg.viewBox[3],
    tags: [...new Set([...cat.tags, ...variantTags, `size-${size.toLowerCase()}`])],
    colors: extractColors(text),
  });
  fs.copyFileSync(path.join(ASSETS, file), path.join(OUT_SVG, file)); // unchanged copy
}

// One uniform factor per size set (median of per-object L/S width ratios),
// so switching L <-> S keeps the composition footprint without breaking
// proportions inside a set.
const ratios: number[] = [];
for (const o of objects.filter((x) => x.size === 'S' && x.type === 'main')) {
  const l = objects.find((x) => x.size === 'L' && x.type === 'main' && x.key === o.key);
  if (l) ratios.push(l.width / o.width);
}
ratios.sort((a, b) => a - b);
const sRatio = ratios.length ? Math.round(ratios[Math.floor(ratios.length / 2)] * 1000) / 1000 : 2;

const sourcePalette = [...new Set(objects.flatMap((o) => o.colors))].sort();
const library: Library = {
  generatedAt: new Date().toISOString().slice(0, 10),
  sizeScale: { L: 1, S: sRatio },
  sourcePalette,
  objects,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(library, null, 2) + '\n');
console.log(`library.json: ${objects.length} objects, S factor ${sRatio}, palette ${sourcePalette.join(' ')}`);
