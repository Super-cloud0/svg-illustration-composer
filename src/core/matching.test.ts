import { describe, expect, it } from 'vitest';
import { matchPhrase, parseComponents } from './matching';

const keys = (p: { key: string }[]) => p.map((x) => x.key);

describe('matchPhrase (scenario 1)', () => {
  it('maps metaphors through the synonym dictionary, with reasons', () => {
    const study = matchPhrase('учёба и концентрация');
    expect(keys(study)).toEqual(expect.arrayContaining(['book', 'headphones', 'lamp']));
    expect(study[0].reasons[0]).toMatch(/учеба/);
    expect(keys(matchPhrase('Финансовая грамотность'))).toEqual(expect.arrayContaining(['wallet', 'coin']));
  });
  it('always returns 2..4 objects, with a fallback when nothing matches', () => {
    const none = matchPhrase('абракадабра');
    expect(none.length).toBeGreaterThanOrEqual(2);
    expect(none[0].reasons[0]).toMatch(/совпадений/);
    expect(matchPhrase('лампа').length).toBe(2); // companion added
  });
});

describe('parseComponents (scenario 2)', () => {
  it('parses names, background variants, counts and unknown names', () => {
    const r = parseComponents('книга, наушники и фоновая лампа; 2 монеты, единорог');
    expect(keys(r.picks)).toEqual(['book', 'headphones', 'lamp', 'coin', 'coin']);
    expect(r.picks[2].variant).toBe('bg');
    expect(r.unknown).toEqual(['единорог']);
  });
  it('understands word forms and English', () => {
    expect(keys(parseComponents('кошелёк, ручку, цветы, phone').picks)).toEqual(['wallet', 'pen', 'flowers', 'phone']);
  });
});
