// Generates example compositions with the same core code the web app uses
// (matching -> auto-layout -> export) and renders PNG previews.
// Usage: npm run examples            -> examples/*.svg + *.png
//        npx tsx scripts/make-examples.ts --sheet <out.png>  -> layout contact sheet (debug)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import libraryJson from '../src/data/library.json';
import { buildSvg, type AssetResolver } from '../src/core/export';
import { autoLayout } from '../src/core/layout';
import { matchPhrase, parseComponents, promoteBackground, type Pick } from '../src/core/matching';
import { BUILTIN_PALETTES } from '../src/core/palettes';
import { parseSvg } from '../src/core/svg';
import type { Composition, DecorId, Library, SizeSet, SvgAsset, TemplateId } from '../src/core/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = libraryJson as Library;
const cache = new Map<string, SvgAsset>();
const svgOf = (file: string) => {
  if (!cache.has(file)) cache.set(file, parseSvg(fs.readFileSync(path.join(ROOT, 'public', 'library', file), 'utf8')));
  return cache.get(file);
};
const resolver: AssetResolver = {
  entry: (item, comp) => LIB.objects.find((o) => o.key === item.key && o.type === item.variant && o.size === comp.size),
  svg: svgOf,
  unit: (e) => LIB.sizeScale[e.size],
  decor: (id) => LIB.decor.find((d) => d.id === id),
};

interface Spec {
  name: string;
  scenario: 'metaphor' | 'components';
  input: string;
  template: TemplateId;
  W: number;
  H: number;
  size: SizeSet;
  palette: string;
  decor: DecorId;
  seed?: number;
}

export function compose(s: Spec): { comp: Composition; picks: Pick[] } {
  const area = (key: string) => {
    const e = LIB.objects.find((o) => o.key === key && o.size === 'L' && o.type === 'main');
    return e ? e.width * e.height : 0;
  };
  const picks = s.scenario === 'metaphor' ? promoteBackground(matchPhrase(s.input), area) : parseComponents(s.input).picks;
  const objs = picks.map((p) => {
    const e = LIB.objects.find((o) => o.key === p.key && o.type === p.variant && o.size === s.size)!;
    const u = LIB.sizeScale[s.size];
    return { key: p.key, variant: p.variant, w: e.width * u, h: e.height * u };
  });
  const res = autoLayout(objs, s.W, s.H, s.template, s.seed ?? 0);
  return {
    picks,
    comp: {
      width: s.W,
      height: s.H,
      size: s.size,
      paletteId: s.palette,
      scale: res.scale,
      decor: s.decor,
      items: res.items.map((it, i) => ({ ...it, uid: `i${i}` })),
    },
  };
}

function render(spec: Spec) {
  const { comp, picks } = compose(spec);
  const palette = BUILTIN_PALETTES.find((p) => p.id === spec.palette)!;
  const svg = buildSvg(comp, palette, resolver);
  return { svg, picks, comp };
}

const EXAMPLES: Spec[] = [
  { name: '01_metaphor_ucheba-i-koncentraciya', scenario: 'metaphor', input: 'учёба и концентрация', template: 'title', W: 1200, H: 630, size: 'L', palette: 'purple', decor: 'none' },
  { name: '02_metaphor_finansovaya-gramotnost', scenario: 'metaphor', input: 'финансовая грамотность', template: 'collected', W: 1200, H: 1200, size: 'L', palette: 'peach', decor: 'waves' },
  { name: '03_components_phone-headphones-bg-flowers', scenario: 'components', input: 'телефон, наушники, фоновые цветы', template: 'offset', W: 1080, H: 1350, size: 'S', palette: 'teal', decor: 'confetti', seed: 1 },
];

async function main() {
  const sheetIdx = process.argv.indexOf('--sheet');
  if (sheetIdx > 0) {
    // Debug: every template × a few inputs × formats on one sheet.
    const inputs: [Spec['scenario'], string][] = [
      ['metaphor', 'учёба и концентрация'],
      ['metaphor', 'финансовая грамотность'],
      ['components', 'книга, телефон, пазл'],
      ['components', 'наушники, фоновые цветы'],
      ['components', 'папка, ручка, монета, кошелёк, лампа'],
    ];
    const formats: [number, number][] = [
      [1200, 630],
      [1080, 1350],
    ];
    const tiles: string[] = [];
    let y = 0;
    const cellW = 360;
    for (const [W, H] of formats) {
      const cellH = (cellW * H) / W;
      for (const [scenario, input] of inputs) {
        let x = 0;
        for (const template of ['title', 'offset', 'collected'] as TemplateId[]) {
          const { svg } = render({ name: '', scenario, input, template, W, H, size: 'L', palette: 'purple', decor: 'none' });
          const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
          tiles.push(`<svg x="${x}" y="${y}" width="${cellW}" height="${cellH}" viewBox="0 0 ${W} ${H}">${inner}</svg>`);
          x += cellW + 8;
        }
        y += cellH + 8;
      }
    }
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${3 * cellW + 16}" height="${y}"><rect width="100%" height="100%" fill="#fff"/>${tiles.join('')}</svg>`;
    fs.writeFileSync(process.argv[sheetIdx + 1], new Resvg(sheet).render().asPng());
    return;
  }

  const dir = path.join(ROOT, 'examples');
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const spec of EXAMPLES) {
    const { svg, picks, comp } = render(spec);
    fs.writeFileSync(path.join(dir, `${spec.name}.svg`), svg);
    fs.writeFileSync(path.join(dir, `${spec.name}.png`), new Resvg(svg, { fitTo: { mode: 'width', value: 800 } }).render().asPng());
    lines.push(
      `### ${spec.name}\n` +
        `- Сценарий: ${spec.scenario === 'metaphor' ? 'метафора' : 'компоненты'} — «${spec.input}»\n` +
        `- Шаблон: ${spec.template}, формат ${spec.W}×${spec.H}, размер ${spec.size}, палитра ${spec.palette}, декор ${spec.decor}, масштаб ${Math.round(comp.scale * 100)}%\n` +
        picks.map((p) => `- ${p.key}${p.variant === 'bg' ? ' (фон)' : ''}: ${p.reasons.join('; ')}`).join('\n') +
        `\n\n![${spec.name}](${spec.name}.png)\n`,
    );
    console.log('example', spec.name, comp.items.map((i) => i.key).join(','));
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# Примеры композиций\n\nСгенерированы `npm run examples` тем же кодом, что и веб-приложение.\n\n' + lines.join('\n'));
}

main();
