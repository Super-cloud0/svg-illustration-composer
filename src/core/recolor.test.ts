import { describe, expect, it } from 'vitest';
import { normalizeMap, parsePaletteJson, recolorMarkup } from './recolor';
import { extractColors, normalizeColor } from './svg';
import peach from '../data/palettes/peach.json';

const SRC = `<path d="M10 20C30 40 50 60 70 80Z" fill="#D7CDF5"/>
<path d="M1 2L3 4Z" fill="white" stroke="#181817"/>
<rect width="5" height="5" style="fill:#f9a3aa;stroke-width:2"/>
<path d="M0 0" fill="none" fill-rule="evenodd"/>`;

describe('normalizeColor', () => {
  it('normalizes hex, short hex, keywords and rgb()', () => {
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeColor('#fff')).toBe('#ffffff');
    expect(normalizeColor('white')).toBe('#ffffff');
    expect(normalizeColor('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(normalizeColor('none')).toBeNull();
    expect(normalizeColor('url(#grad)')).toBeNull();
  });
});

describe('recolorMarkup', () => {
  it('maps fill, stroke and inline style colors case-insensitively', () => {
    const out = recolorMarkup(SRC, { '#d7cdf5': '#fdd7b9', '#ffffff': '#fefefe', '#F9A3AA': '#80dada', '#181817': '#000000' });
    expect(out).toContain('fill="#fdd7b9"');
    expect(out).toContain('fill="#fefefe"');
    expect(out).toContain('stroke="#000000"');
    expect(out).toContain('style="fill:#80dada;stroke-width:2"');
    expect(extractColors(out)).toEqual(['#000000', '#80dada', '#fdd7b9', '#fefefe']);
  });

  it('never touches geometry, fill="none" or fill-rule', () => {
    const out = recolorMarkup(SRC, peach.map);
    const paths = (s: string) => [...s.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
    expect(paths(out)).toEqual(paths(SRC));
    expect(out).toContain('fill="none" fill-rule="evenodd"');
  });

  it('leaves unmapped colors and is a no-op for an empty map', () => {
    expect(recolorMarkup(SRC, {})).toBe(SRC);
    expect(recolorMarkup(SRC, { '#123456': '#654321' })).toBe(SRC);
  });

  it('built-in palettes cover every color used by the library', () => {
    const map = normalizeMap(peach.map);
    for (const c of ['#181817', '#7864d7', '#aa9bf0', '#d7cdf5', '#f9a3aa', '#f9ecb0', '#ffe3e1', '#ffffff']) expect(map[c]).toBeDefined();
  });
});

describe('parsePaletteJson', () => {
  it('accepts the role format', () => {
    const p = parsePaletteJson(JSON.stringify({ name: 'Mint', roles: { bgLight: '#E0F5EC', accent1: '#fc0' } }), 'x');
    expect(p.name).toBe('Mint');
    expect(p.map['#d7cdf5']).toBe('#e0f5ec');
    expect(p.map['#f9ecb0']).toBe('#ffcc00');
    expect(p.background).toBe('#e0f5ec');
  });
  it('accepts the map format and rejects garbage', () => {
    expect(parsePaletteJson('{"map":{"#d7cdf5":"#000"}}', 'id1').id).toBe('id1');
    expect(() => parsePaletteJson('not json', 'x')).toThrow();
    expect(() => parsePaletteJson('{"map":{"a":"b"}}', 'x')).toThrow();
  });
});
