// Rebuilds the reference compositions ("Примеры композиций" + "SVG-drop" frames)
// from exact Figma node positions and our exported assets, then renders PNGs.
// Used because Figma's image-render endpoint is rate-limited for view-only seats.
// Decorative background shapes (confetti, lines) are not reproduced — objects only.
// Usage: npx tsx scripts/rebuild-references.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { parseSvg } from '../src/core/svg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_KEY = '4MCFttsSoP7hgQh29zq5G3';
const token = process.env.FIGMA_TOKEN ?? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^FIGMA_TOKEN=(.+)$/m)![1].trim();

const NAME_TO_KEY: Record<string, string> = {
  Книга: 'book', Телефон: 'phone', Пазлы: 'puzzle', Монета: 'coin', Наушники: 'headphones',
  Лампа: 'lamp', Кошелек: 'wallet', Ручка: 'pen', Папка: 'folder',
};
const DROP_FRAMES = ['275:2', '275:213', '275:424', '275:635', '275:1042', '275:1449'];
const EXAMPLES_SECTION = '25:11069';

type Node = {
  id: string; name: string; type: string; children?: Node[];
  absoluteBoundingBox: { x: number; y: number; width: number; height: number };
  fills?: { type: string; color?: { r: number; g: number; b: number } }[];
};
const hex = (c: { r: number; g: number; b: number }) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function objectKey(n: Node): string | null {
  if (NAME_TO_KEY[n.name]) return NAME_TO_KEY[n.name];
  const m = n.name.match(/^([a-z]+)-/); // SVG-drop frames: "lamp-mvv17flp-1"
  if (m && Object.values(NAME_TO_KEY).concat('flowers').includes(m[1])) return m[1];
  if ((n.children?.length ?? 0) > 100 && Math.abs(n.absoluteBoundingBox.width / n.absoluteBoundingBox.height - 591 / 747) < 0.03) return 'flowers';
  return null;
}
function variantOf(n: Node): 'main' | 'bg' {
  const colors = new Set<string>();
  const walk = (x: Node) => {
    x.fills?.forEach((f) => f.color && colors.add(hex(f.color)));
    x.children?.forEach(walk);
  };
  walk(n);
  return colors.has('#f9ecb0') || colors.has('#181817') ? 'main' : 'bg';
}

async function main() {
  const ids = [EXAMPLES_SECTION, ...DROP_FRAMES].join(',');
  const res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${encodeURIComponent(ids)}&depth=4`, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) throw new Error(`Figma ${res.status}`);
  const data = (await res.json()) as { nodes: Record<string, { document: Node }> };
  const frames: { name: string; node: Node }[] = [];
  data.nodes[EXAMPLES_SECTION].document.children!.filter((c) => c.type === 'FRAME').forEach((c, i) => {
    const b = c.absoluteBoundingBox;
    frames.push({ name: `example_${String(i + 1).padStart(2, '0')}_${b.width}x${b.height}`, node: c });
  });
  for (const id of DROP_FRAMES) {
    const n = data.nodes[id].document;
    frames.push({ name: n.name.replace('SVG-drop · ', 'svgdrop_').replace(/ · /g, '_').replace(/ × /g, 'x').replace(/\s+/g, '-'), node: n });
  }

  const outDir = path.join(ROOT, 'reference');
  fs.mkdirSync(outDir, { recursive: true });
  const notes: string[] = [];
  for (const { name, node } of frames) {
    const fb = node.absoluteBoundingBox;
    const W = Math.round(fb.width), H = Math.round(fb.height);
    const bg = node.fills?.find((f) => f.color)?.color;
    const size = /_S_/.test(name) ? 'S' : 'L';
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">`, `<rect width="${W}" height="${H}" fill="${bg ? hex(bg) : '#ffffff'}"/>`];
    const used: string[] = [];
    for (const child of node.children ?? []) {
      const key = objectKey(child);
      if (!key) continue;
      const variant = variantOf(child);
      const file = path.join(ROOT, 'assets', `${size}_${variant}_${key}.svg`);
      if (!fs.existsSync(file)) continue;
      const svg = parseSvg(fs.readFileSync(file, 'utf8'));
      const b = child.absoluteBoundingBox;
      const scale = b.width / svg.viewBox[2];
      parts.push(`<g id="${key}-${variant}" transform="translate(${(b.x - fb.x).toFixed(2)} ${(b.y - fb.y).toFixed(2)}) scale(${scale.toFixed(4)})">${svg.inner}</g>`);
      used.push(`${key}/${variant}@${scale.toFixed(2)}`);
    }
    parts.push('</svg>');
    const svgText = parts.join('\n');
    fs.writeFileSync(path.join(outDir, `${name}.svg`), svgText);
    const png = new Resvg(svgText, { fitTo: { mode: 'width', value: Math.min(600, W) } }).render().asPng();
    fs.writeFileSync(path.join(outDir, `${name}.png`), png);
    notes.push(`${name}: ${used.join(', ')}`);
    console.log(name, used.join(', '));
  }
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    '# Референсы из Figma\n\nПересобраны из точных координат узлов Figma (GET /v1/files/:key/nodes) и экспортированных ассетов: ' +
      'рендер-эндпоинт Figma (/v1/images) для токена с правами просмотра ограничен по частоте. Декоративные элементы фона (конфетти, линии) не воспроизводятся.\n\n' +
      'Формат: объект/вариант@масштаб относительно исходного размера.\n\n' + notes.map((n) => `- ${n}`).join('\n') + '\n',
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
