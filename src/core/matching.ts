import catalogJson from '../data/catalog.json';
import synonymsJson from '../data/synonyms.json';
import type { Variant } from './types';

export interface CatalogEntry {
  ru: string;
  en: string;
  tags: string[];
}
export const CATALOG = catalogJson as Record<string, CatalogEntry>;
const SYN = synonymsJson as {
  concepts: { label: string; words: string[]; objects: string[] }[];
  companions: Record<string, string[]>;
  fallback: string[];
};

export interface Pick {
  key: string;
  variant: Variant;
  reasons: string[];
  score: number;
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Crude Russian/English stemming: the prefix a word form must start with. */
function stemOf(term: string): string {
  if (term.length <= 3) return term;
  if (term.length === 4) return term;
  if (term.length === 5) return term.slice(0, 4);
  return term.slice(0, Math.max(5, term.length - 2));
}

/** Does a dictionary term occur in the phrase (word-form tolerant)? Returns the matched token. */
export function findTerm(phrase: string, tokens: string[], rawTerm: string): string | null {
  const term = normalizeText(rawTerm);
  if (!term) return null;
  if (term.includes(' ')) return phrase.includes(term) ? term : null;
  const stem = stemOf(term);
  for (const t of tokens) {
    if (term.length <= 3 ? t === term : t.startsWith(stem)) return t;
  }
  return null;
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

/**
 * Scenario 1: map a metaphor / headline to 2–5 library objects using the
 * hand-written synonym dictionary. Each pick carries human-readable reasons.
 */
export function matchPhrase(text: string, available: string[] = Object.keys(CATALOG), max = 4): Pick[] {
  const phrase = normalizeText(text);
  const tokens = tokenize(text);
  const scores = new Map<string, Pick>();
  const add = (key: string, pts: number, reason: string) => {
    if (!available.includes(key)) return;
    const p = scores.get(key) ?? { key, variant: 'main' as Variant, reasons: [], score: 0 };
    p.score += pts;
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    scores.set(key, p);
  };

  // Direct object names ("лампа") weigh the most.
  for (const [key, entry] of Object.entries(CATALOG)) {
    for (const tag of entry.tags) {
      const hit = findTerm(phrase, tokens, tag);
      if (hit) {
        add(key, 3, `объект назван прямо: «${hit}»`);
        break;
      }
    }
  }
  // Associations: concept words -> objects (first object of a concept is the strongest).
  for (const c of SYN.concepts) {
    for (const w of c.words) {
      const hit = findTerm(phrase, tokens, w);
      if (hit) {
        c.objects.forEach((key, i) => add(key, i === 0 ? 2 : 1, `«${hit}» → тема «${c.label}»`));
        break;
      }
    }
  }

  let picks = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, max);

  if (picks.length === 0) {
    picks = SYN.fallback
      .filter((k) => available.includes(k))
      .slice(0, 3)
      .map((key) => ({ key, variant: 'main' as Variant, score: 0, reasons: ['совпадений в словаре нет — универсальный набор (попробуйте AI-подбор)'] }));
  }
  // A composition needs at least two objects: add natural companions.
  for (const p of [...picks]) {
    if (picks.length >= 2) break;
    for (const c of SYN.companions[p.key] ?? []) {
      if (picks.length >= 2) break;
      if (available.includes(c) && !picks.some((x) => x.key === c)) {
        picks.push({ key: c, variant: 'main', score: 0, reasons: [`дополняет «${CATALOG[p.key].ru.toLowerCase()}» для баланса композиции`] });
      }
    }
  }
  return picks;
}

/**
 * Like in the reference compositions: a big supporting object (much larger than
 * the most relevant one) becomes a monochrome background variant so it adds
 * context without dwarfing the main objects. At most one per composition.
 */
export function promoteBackground(picks: Pick[], areaOf: (key: string) => number): Pick[] {
  if (picks.length < 3) return picks;
  const areas = picks.map((p) => areaOf(p.key)).sort((a, b) => a - b);
  const median = areas[Math.floor((areas.length - 1) / 2)];
  let done = false;
  return picks.map((p) => {
    if (done || p.variant === 'bg' || areaOf(p.key) < median * 2.5) return p;
    done = true;
    return { ...p, variant: 'bg' as Variant, reasons: [...p.reasons, 'крупный второстепенный объект — фоновым вариантом, чтобы не перекрывать главные'] };
  });
}

export interface ParsedComponents {
  picks: Pick[];
  unknown: string[];
}

const BG_WORDS = ['фон', 'фоновый', 'фоновая', 'фоновое', 'фоновые', 'bg', 'background', 'монохром'];

/** Scenario 2: "книга, наушники, фоновая лампа, 2 монеты" -> objects. */
export function parseComponents(text: string, available: string[] = Object.keys(CATALOG)): ParsedComponents {
  const chunks = text
    .split(/[,;\n+/]|\s+и\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const picks: Pick[] = [];
  const unknown: string[] = [];
  for (const chunk of chunks) {
    let tokens = tokenize(chunk);
    let count = 1;
    const num = tokens.find((t) => /^\d+$/.test(t)) ?? tokens.find((t) => /^x\d+$/.test(t));
    if (num) {
      count = Math.min(5, Math.max(1, parseInt(num.replace('x', ''), 10)));
      tokens = tokens.filter((t) => t !== num);
    }
    const variant: Variant = tokens.some((t) => BG_WORDS.includes(t)) ? 'bg' : 'main';
    tokens = tokens.filter((t) => !BG_WORDS.includes(t));
    const phrase = tokens.join(' ');
    let found: string | null = null;
    for (const [key, entry] of Object.entries(CATALOG)) {
      if (!available.includes(key)) continue;
      if (entry.tags.some((tag) => findTerm(phrase, tokens, tag))) {
        found = key;
        break;
      }
    }
    if (!found) {
      unknown.push(chunk);
      continue;
    }
    for (let i = 0; i < count; i++) {
      picks.push({ key: found, variant, score: 0, reasons: [`указан компонент «${chunk}»${variant === 'bg' ? ' (фоновый вариант)' : ''}`] });
    }
  }
  return { picks, unknown };
}
