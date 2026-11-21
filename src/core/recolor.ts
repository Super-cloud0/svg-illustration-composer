import { COLOR_ATTR_RE, normalizeColor } from './svg';
import type { Palette } from './types';

/**
 * Recolor SVG markup by mapping colors: every fill / stroke / stop-color value
 * found in `map` is replaced, everything else (geometry included) is untouched.
 */
export function recolorMarkup(markup: string, map: Record<string, string>): string {
  const norm = normalizeMap(map);
  if (Object.keys(norm).length === 0) return markup;
  return markup.replace(COLOR_ATTR_RE, (whole, attr: string, sep: string, value: string) => {
    const c = normalizeColor(value);
    const target = c ? norm[c] : undefined;
    return target ? `${attr}${sep}${target}` : whole;
  });
}

export function normalizeMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(map)) {
    const f = normalizeColor(from);
    const t = normalizeColor(to);
    if (f && t) out[f] = t;
  }
  return out;
}

/** Roles of the source (purple) palette, as laid out in the Figma library. */
export const PALETTE_ROLES = {
  bgLight: '#d7cdf5',
  bgMid: '#aa9bf0',
  bgDark: '#7864d7',
  accent1: '#f9ecb0',
  accent2: '#f9a3aa',
  accent3: '#ffe3e1',
  ink: '#181817',
  paper: '#ffffff',
} as const;
export type PaletteRole = keyof typeof PALETTE_ROLES;

/**
 * Parse a user palette JSON. Two formats are accepted:
 *  1) { name, background?, map: { "#source": "#target", ... } }
 *  2) { name, background?, roles: { bgLight, bgMid, bgDark, accent1, accent2, accent3, ink?, paper? } }
 */
export function parsePaletteJson(text: string, fallbackId: string): Palette {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('Ожидался JSON-объект');
  const d = data as Record<string, unknown>;
  const map: Record<string, string> = {};
  if (d.map && typeof d.map === 'object') {
    Object.assign(map, normalizeMap(d.map as Record<string, string>));
  }
  if (d.roles && typeof d.roles === 'object') {
    for (const [role, color] of Object.entries(d.roles as Record<string, string>)) {
      const src = PALETTE_ROLES[role as PaletteRole];
      const t = typeof color === 'string' ? normalizeColor(color) : null;
      if (src && t) map[src] = t;
    }
  }
  if (Object.keys(map).length === 0) throw new Error('В палитре нет ни одного корректного цвета (map или roles)');
  const bg =
    (typeof d.background === 'string' && normalizeColor(d.background)) || map[PALETTE_ROLES.bgLight] || PALETTE_ROLES.bgLight;
  return {
    id: typeof d.id === 'string' && d.id ? d.id : fallbackId,
    name: typeof d.name === 'string' && d.name ? d.name : 'Своя палитра',
    background: bg,
    map,
    custom: true,
  };
}
