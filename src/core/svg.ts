import type { SvgAsset } from './types';

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
};

/** Normalize a CSS color to lowercase #rrggbb. Returns null for none/url()/currentColor etc. */
export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return '#' + m[1];
  m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
  return null;
}

/** Matches color-bearing attributes and inline style declarations. */
export const COLOR_ATTR_RE = /\b(fill|stroke|stop-color|flood-color|lighting-color)(\s*=\s*"|\s*:\s*)([^";]+)/g;

/** All distinct fill/stroke colors used in SVG markup. */
export function extractColors(markup: string): string[] {
  const set = new Set<string>();
  for (const m of markup.matchAll(COLOR_ATTR_RE)) {
    const c = normalizeColor(m[3]);
    if (c) set.add(c);
  }
  return [...set].sort();
}

/**
 * Split an SVG document into its viewBox and inner markup. The inner markup is
 * kept byte-for-byte: this is what gets embedded into compositions.
 */
export function parseSvg(text: string): SvgAsset {
  const open = text.match(/<svg\b[^>]*>/i);
  const close = text.toLowerCase().lastIndexOf('</svg>');
  if (!open || close < 0) throw new Error('Not an SVG document');
  const attrs = open[0];
  const num = (name: string) => {
    const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([\\d.]+)(px)?"`));
    return m ? parseFloat(m[1]) : NaN;
  };
  let viewBox: SvgAsset['viewBox'];
  const vb = attrs.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    viewBox = [p[0], p[1], p[2], p[3]];
  } else {
    viewBox = [0, 0, num('width') || 100, num('height') || 100];
  }
  if (viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('Invalid viewBox');
  const start = (open.index ?? 0) + open[0].length;
  const inner = text.slice(start, close).trim();
  // The root <svg fill="none"> default must survive once the root is dropped.
  const rootFill = attrs.match(/\sfill\s*=\s*"([^"]+)"/);
  return { viewBox, inner: rootFill ? `<g fill="${rootFill[1]}">${inner}</g>` : inner };
}

/**
 * Make an untrusted (uploaded) SVG safe and collision-free:
 * drops scripts / event handlers / external refs and prefixes all ids.
 */
export function sanitizeSvg(text: string, idPrefix: string): string {
  let s = text
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|foreignObject|iframe|image)\b[\s\S]*?(<\/\1>|\/>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*")(?!#)[^"]*"/gi, '$1#"');
  const ids = [...s.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s
      .replace(new RegExp(`(\\sid\\s*=\\s*")${esc}"`, 'g'), `$1${idPrefix}${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${idPrefix}${id})`)
      .replace(new RegExp(`(href\\s*=\\s*")#${esc}"`, 'g'), `$1#${idPrefix}${id}"`);
  }
  return s;
}
