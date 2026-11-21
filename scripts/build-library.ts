// Build-time indexer: reads assets/*.svg, parses each file, extracts its colors
// and writes src/data/library.json. The SVG files themselves are copied
// unchanged to public/library/ and fetched by the app at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../src/data/catalog.json';
import { extractColors, parseSvg } from '../src/core/svg';
import { recolorMarkup } from '../src/core/recolor';
import type { DecorAsset, Library, LibraryObject, SizeSet, Variant } from '../src/core/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT_SVG = path.join(ROOT, 'public', 'library');
const OUT_JSON = path.join(ROOT, 'src', 'data', 'library.json');

const CAT = catalog as Record<string, { ru: string; en: string; tags: string[] }>;
const FILE_RE = /^([LS])_(main|bg)_([a-z0-9-]+)\.svg$/;

fs.rmSync(OUT_SVG, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_SVG, 'decor'), { recursive: true });

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

// Decor: the scheme backgrounds from the library page. Strip the full-frame
// background rect / clip (the canvas draws its own background) and bring the
// colors to the source (purple) palette so one palette map recolors everything.
const DECOR_TO_SOURCE: Record<string, string> = { '#fdd7b9': '#d7cdf5', '#fac896': '#aa9bf0', '#d27532': '#7864d7' };
const DECOR_NAMES: Record<string, string> = { confetti: 'Конфетти', waves: 'Волна' };
const decor: DecorAsset[] = [];
const decorDir = path.join(ASSETS, 'decor');
if (fs.existsSync(decorDir)) {
  for (const file of fs.readdirSync(decorDir).filter((f) => f.endsWith('.svg')).sort()) {
    let text = fs.readFileSync(path.join(decorDir, file), 'utf8');
    text = text
      .replace(/<rect width="(\d+)" height="(\d+)" fill="#[0-9A-Fa-f]{6}"\/>\n?/, '')
      .replace(/<g clip-path="url\(#[^)]+\)">/, '<g>')
      .replace(/<defs>[\s\S]*?<\/defs>\n?/, '');
    text = recolorMarkup(text, DECOR_TO_SOURCE);
    const svg = parseSvg(text);
    const id = file.replace(/\.svg$/, '') as DecorAsset['id'];
    fs.writeFileSync(path.join(OUT_SVG, 'decor', file), text);
    decor.push({ id, name: DECOR_NAMES[id] ?? id, file: `decor/${file}`, width: svg.viewBox[2], height: svg.viewBox[3], colors: extractColors(text) });
  }
}

const sourcePalette = [...new Set(objects.flatMap((o) => o.colors))].sort();
const library: Library = {
  generatedAt: new Date().toISOString().slice(0, 10),
  sizeScale: { L: 1, S: sRatio },
  sourcePalette,
  objects,
  decor,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(library, null, 2) + '\n');
console.log(`library.json: ${objects.length} objects, ${decor.length} decor, S factor ${sRatio}, palette ${sourcePalette.join(' ')}`);
