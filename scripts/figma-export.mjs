// One-off asset export from the Figma file via REST API.
// Usage: node scripts/figma-export.mjs   (needs FIGMA_TOKEN in .env)
// Exports every library object (L/S × main/bg) to assets/, plus reference
// compositions to reference/. Geometry is exported as-is; the only
// post-processing is merging the book's detached piece into the book SVG.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const FILE_KEY = '4MCFttsSoP7hgQh29zq5G3';

function readToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = env.match(/^FIGMA_TOKEN=(.+)$/m);
  if (!m) throw new Error('FIGMA_TOKEN not found');
  return m[1].trim();
}
const TOKEN = readToken();

// Node ids on page "Библиотека компонентов" (found via GET /v1/files/:key).
const OBJECTS = {
  L: {
    main: { book: '21:29965', phone: '21:25472', puzzle: '21:417', coin: '24:2207', headphones: '23:122', lamp: '23:121', wallet: '23:211', pen: '24:1734', folder: '24:1899', flowers: '28:11628' },
    bg: { book: '24:6273', phone: '24:6327', puzzle: '24:6214', coin: '24:6795', headphones: '24:6484', lamp: '24:6569', wallet: '24:6660', pen: '24:6747', folder: '24:6772', flowers: '30:11902' },
  },
  S: {
    main: { book: '24:3810', phone: '24:4746', puzzle: '24:4903', coin: '24:5345', headphones: '24:5089', lamp: '24:5485', wallet: '24:4594', pen: '24:4287', folder: '24:4430', flowers: '28:11629' },
    bg: { book: '24:6934', phone: '24:6990', puzzle: '24:7147', coin: '24:7205', headphones: '24:7344', lamp: '24:7429', wallet: '24:7568', pen: '24:7543', folder: '24:7520', flowers: '28:11766' },
  },
};
// L book has a small piece that lives outside its group in Figma.
const BOOK_EXTRA = { L_main: '21:29952', L_bg: '24:6272' };
// Background decor frames (scheme backgrounds with confetti / lines).
const DECOR = { confetti: '21:25258', waves: '21:25399' };

async function api(url) {
  for (let i = 1; ; i++) {
    const res = await fetch(`https://api.figma.com/v1/${url}`, { headers: { 'X-Figma-Token': TOKEN } });
    if (res.status === 429 && i < 6) {
      const wait = Number(res.headers.get('retry-after')) || 30 * i;
      console.log(`rate limited, waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
}

async function exportNodes(ids, format) {
  const out = {};
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const q = format === 'svg' ? '&svg_outline_text=true&svg_include_id=false&svg_simplify_stroke=true' : '&scale=0.5';
    const data = await api(`images/${FILE_KEY}?ids=${encodeURIComponent(chunk.join(','))}&format=${format}${q}`);
    if (data.err) throw new Error(data.err);
    Object.assign(out, data.images);
  }
  return out;
}

async function download(url, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function boxes(ids) {
  const data = await api(`files/${FILE_KEY}/nodes?ids=${encodeURIComponent(ids.join(','))}&depth=1`);
  const r = {};
  for (const [id, n] of Object.entries(data.nodes)) r[id] = { box: n.document.absoluteBoundingBox, name: n.document.name };
  return r;
}

/** Insert the inner content of `extraSvg` into `mainSvg`, translated by (dx, dy). */
function mergeSvg(mainSvg, extraSvg, dx, dy) {
  const inner = extraSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return mainSvg.replace(/<\/svg>\s*$/, `<g transform="translate(${dx} ${dy})">${inner}</g>\n</svg>\n`);
}

async function main() {
  const assetsDir = path.join(ROOT, 'assets');
  const refDir = path.join(ROOT, 'reference');
  fs.mkdirSync(path.join(assetsDir, 'decor'), { recursive: true });
  fs.mkdirSync(refDir, { recursive: true });

  const refsOnly = process.argv.includes('--refs-only');
  if (!refsOnly) await exportAssets(assetsDir);
  await exportReferences(refDir);
}

async function exportAssets(assetsDir) {
  const jobs = []; // { id, file }
  for (const [size, types] of Object.entries(OBJECTS))
    for (const [type, objs] of Object.entries(types))
      for (const [name, id] of Object.entries(objs)) jobs.push({ id, file: path.join(assetsDir, `${size}_${type}_${name}.svg`) });
  for (const [name, id] of Object.entries(DECOR)) jobs.push({ id, file: path.join(assetsDir, 'decor', `${name}.svg`) });
  const extraIds = Object.values(BOOK_EXTRA);

  const urls = await exportNodes([...jobs.map((j) => j.id), ...extraIds], 'svg');
  const svgs = {};
  for (const id of Object.keys(urls)) svgs[id] = (await download(urls[id])).toString('utf8');

  // Merge book extras.
  const bx = await boxes([OBJECTS.L.main.book, OBJECTS.L.bg.book, ...extraIds]);
  for (const [key, extraId] of Object.entries(BOOK_EXTRA)) {
    const bookId = key === 'L_main' ? OBJECTS.L.main.book : OBJECTS.L.bg.book;
    const dx = Math.round(bx[extraId].box.x - bx[bookId].box.x);
    const dy = Math.round(bx[extraId].box.y - bx[bookId].box.y);
    svgs[bookId] = mergeSvg(svgs[bookId], svgs[extraId], dx, dy);
  }
  for (const j of jobs) {
    fs.writeFileSync(j.file, svgs[j.id]);
    console.log('asset', path.relative(ROOT, j.file));
  }
}

async function exportReferences(refDir) {
  // Reference compositions: "Примеры композиций" frames + "SVG-drop" frames.
  const file = await api(`files/${FILE_KEY}?depth=3`);
  const refs = [];
  for (const page of file.document.children) {
    if (page.name === 'Примеры композиций') {
      const section = page.children[0];
      section.children.filter((c) => c.type === 'FRAME').forEach((c, i) => {
        const b = c.absoluteBoundingBox;
        refs.push({ id: c.id, name: `example_${String(i + 1).padStart(2, '0')}_${b.width}x${b.height}` });
      });
    }
    if (page.name === 'Библиотека компонентов') {
      page.children.filter((c) => c.type === 'FRAME' && c.name.startsWith('SVG-drop')).forEach((c) => {
        const slug = c.name.replace('SVG-drop · ', 'svgdrop_').replace(/ · /g, '_').replace(/ × /g, 'x').replace(/\s+/g, '-');
        refs.push({ id: c.id, name: slug });
      });
    }
  }
  const refSvg = await exportNodes(refs.map((r) => r.id), 'svg');
  const refPng = await exportNodes(refs.map((r) => r.id), 'png');
  for (const r of refs) {
    fs.writeFileSync(path.join(refDir, `${r.name}.svg`), await download(refSvg[r.id]));
    fs.writeFileSync(path.join(refDir, `${r.name}.png`), await download(refPng[r.id]));
    console.log('reference', r.name);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
