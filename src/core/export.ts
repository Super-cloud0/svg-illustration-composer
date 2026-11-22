import { recolorMarkup } from './recolor';
import type { Composition, CompositionItem, LibraryObject, Palette, SvgAsset } from './types';

export interface AssetResolver {
  /** library entry for an item in the composition's current size set */
  entry(item: CompositionItem, comp: Composition): LibraryObject | undefined;
  /** parsed SVG content of a library entry */
  svg(file: string): SvgAsset | undefined;
  /** uniform factor for the entry's size set (L = 1) */
  unit(entry: LibraryObject): number;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The only thing ever applied to an object: translate + rotate + one uniform
 * scale shared by the whole composition. Paths stay exactly as in the source.
 */
export function itemTransform(item: CompositionItem, asset: SvgAsset, scale: number): string {
  const [vx, vy, vw, vh] = asset.viewBox;
  const parts = [`translate(${fmt(item.x)} ${fmt(item.y)})`];
  if (item.rotation) parts.push(`rotate(${fmt(item.rotation)})`);
  parts.push(`scale(${Math.round(scale * 10000) / 10000})`);
  parts.push(`translate(${fmt(-(vx + vw / 2))} ${fmt(-(vy + vh / 2))})`);
  return parts.join(' ');
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Build a clean standalone SVG document for the composition. */
export function buildSvg(comp: Composition, palette: Palette, res: AssetResolver): string {
  const W = comp.width,
    H = comp.height;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">`);
  // Nothing may render outside the frame: objects are clipped to the canvas.
  out.push(`  <defs><clipPath id="canvas-clip"><rect width="${W}" height="${H}"/></clipPath></defs>`);
  out.push(`  <rect id="background" width="${W}" height="${H}" fill="${palette.background}"/>`);
  out.push(`  <g id="objects" clip-path="url(#canvas-clip)">`);

  const counters: Record<string, number> = {};
  for (const item of comp.items) {
    const entry = res.entry(item, comp);
    const svg = entry && res.svg(entry.file);
    if (!entry || !svg) continue;
    counters[entry.key] = (counters[entry.key] ?? 0) + 1;
    const id = `${entry.key}${entry.type === 'bg' ? '-bg' : ''}-${counters[entry.key]}`;
    const transform = itemTransform(item, svg, comp.scale * res.unit(entry));
    out.push(
      `    <g id="${escapeAttr(id)}" data-name="${escapeAttr(entry.name)}" data-source="${escapeAttr(entry.id)}" transform="${transform}">` +
        recolorMarkup(svg.inner, palette.map) +
        `</g>`,
    );
  }
  out.push('  </g>');
  out.push('</svg>');
  return out.join('\n') + '\n';
}
