import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSvg, itemTransform, type AssetResolver } from './export';
import { autoLayout } from './layout';
import { parseSvg, sanitizeSvg } from './svg';
import { BUILTIN_PALETTES } from './palettes';
import type { Composition, LibraryObject } from './types';

const ASSETS = path.resolve(__dirname, '../../assets');
const files = ['L_main_book.svg', 'L_main_lamp.svg', 'L_bg_flowers.svg', 'S_main_lamp.svg'];
const svgs = Object.fromEntries(files.map((f) => [f, parseSvg(fs.readFileSync(path.join(ASSETS, f), 'utf8'))]));
const entry = (file: string): LibraryObject => {
  const [size, type, key] = file.replace('.svg', '').split('_');
  const s = svgs[file];
  return { id: file.replace('.svg', ''), key, name: key, nameEn: key, size, type, file, width: s.viewBox[2], height: s.viewBox[3], tags: [], colors: [] } as LibraryObject;
};
const resolver: AssetResolver = {
  entry: (item, comp) => entry(`${comp.size}_${item.variant}_${item.key}.svg`),
  svg: (file) => svgs[file],
  unit: (e) => (e.size === 'S' ? 2 : 1),
};
const comp: Composition = {
  width: 1200,
  height: 630,
  size: 'L',
  paletteId: 'peach',
  scale: 0.5,
  items: [
    { uid: 'a', key: 'flowers', variant: 'bg', x: 300, y: 200, rotation: 0 },
    { uid: 'b', key: 'book', variant: 'main', x: 600, y: 350, rotation: 0 },
    { uid: 'c', key: 'lamp', variant: 'main', x: 900, y: 300, rotation: -15 },
  ],
};
const peach = BUILTIN_PALETTES.find((p) => p.id === 'peach')!;
const paths = (s: string) => [...s.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);

describe('buildSvg', () => {
  const out = buildSvg(comp, peach, resolver);

  it('produces a standalone vector document with the format viewBox', () => {
    expect(out).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1200" height="630" viewBox="0 0 1200 630"/);
    expect(out).toContain('<rect id="background" width="1200" height="630" fill="#fdd7b9"/>');
    expect(out).not.toMatch(/<image|data:image/);
    expect(out.trim().endsWith('</svg>')).toBe(true);
  });

  it('clips all objects to the canvas frame and draws only a flat palette background', () => {
    expect(out).toContain('<clipPath id="canvas-clip"><rect width="1200" height="630"/></clipPath>');
    expect(out).toContain('<g id="objects" clip-path="url(#canvas-clip)">');
    // every object group sits inside the clipped wrapper
    const body = out.slice(out.indexOf('<g id="objects"'), out.lastIndexOf('</svg>'));
    expect((body.match(/data-source=/g) ?? []).length).toBe(3);
    expect(out.indexOf('<rect id="background"')).toBeLessThan(out.indexOf('<g id="objects"'));
    // nothing but the background rect and library objects: no extra shapes before the objects
    const head = out.slice(0, out.indexOf('<g id="objects"'));
    expect(head).not.toMatch(/<path|<line|<circle|<ellipse|<polygon/);
  });

  it('wraps every object into one named group with a transform, in paint order', () => {
    const groups = [...out.matchAll(/<g id="([^"]+)" data-name="[^"]*" data-source="([^"]+)" transform="([^"]+)">/g)];
    expect(groups.map((g) => g[1])).toEqual(['flowers-bg-1', 'book-1', 'lamp-1']);
    expect(groups.map((g) => g[2])).toEqual(['L_bg_flowers', 'L_main_book', 'L_main_lamp']);
    expect(groups[2][3]).toBe('translate(900 300) rotate(-15) scale(0.5) translate(-473 -564.5)');
  });

  it('keeps the original geometry byte-for-byte (only colors change)', () => {
    const original = [svgs['L_bg_flowers.svg'], svgs['L_main_book.svg'], svgs['L_main_lamp.svg']].flatMap((s) => paths(s.inner));
    expect(paths(out)).toEqual(original);
    expect(out).not.toContain('#d7cdf5'); // purple source colors fully mapped to peach
    expect(out).toContain('#d27532');
  });

  it('uses one scale for all objects; S set gets the uniform set factor', () => {
    const scales = [...out.matchAll(/scale\(([\d.]+)\)/g)].map((m) => m[1]);
    expect(new Set(scales)).toEqual(new Set(['0.5']));
    const s = buildSvg({ ...comp, size: 'S', items: [comp.items[2]] }, peach, resolver);
    expect(s).toContain('scale(1)'); // 0.5 × S factor 2
  });
});

describe('itemTransform', () => {
  it('centers on the viewBox origin, including offset viewBoxes', () => {
    const t = itemTransform({ uid: 'x', key: 'k', variant: 'main', x: 10, y: 20, rotation: 0 }, { viewBox: [-50, -50, 100, 200], inner: '' }, 2);
    expect(t).toBe('translate(10 20) scale(2) translate(0 -50)');
  });
});

describe('autoLayout', () => {
  const objs = [
    { key: 'book', variant: 'main' as const, w: 1446, h: 977 },
    { key: 'lamp', variant: 'main' as const, w: 946, h: 1129 },
    { key: 'flowers', variant: 'bg' as const, w: 591, h: 748 },
  ];
  it('returns one scale, background first, and keeps mains inside the frame for "collected"', () => {
    const r = autoLayout(objs, 1200, 1200, 'collected');
    expect(r.items[0].variant).toBe('bg');
    expect(r.scale).toBeGreaterThan(0);
    expect(r.scale).toBeLessThanOrEqual(1);
    for (const it of r.items.filter((i) => i.variant === 'main')) {
      const o = objs.find((x) => x.key === it.key)!;
      expect(it.x - (o.w * r.scale) / 2).toBeGreaterThanOrEqual(-1);
      expect(it.x + (o.w * r.scale) / 2).toBeLessThanOrEqual(1201);
    }
  });
  it('is deterministic for a seed', () => {
    expect(autoLayout(objs, 1200, 630, 'offset', 3)).toEqual(autoLayout(objs, 1200, 630, 'offset', 3));
  });
});

describe('sanitizeSvg', () => {
  it('strips scripts and handlers and prefixes ids', () => {
    const s = sanitizeSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script><g id="a" onclick="x()"><rect fill="url(#a)"/></g></svg>', 'u1_');
    expect(s).not.toMatch(/script|onclick/);
    expect(s).toContain('id="u1_a"');
    expect(s).toContain('url(#u1_a)');
  });
});
