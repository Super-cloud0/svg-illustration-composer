import purple from '../data/palettes/purple.json';
import peach from '../data/palettes/peach.json';
import teal from '../data/palettes/teal.json';
import { PALETTE_ROLES } from './recolor';
import type { Palette } from './types';

export const BUILTIN_PALETTES: Palette[] = [purple, peach, teal];

/** A ready-to-edit palette file the user can download and upload back. */
export function paletteTemplate(base: Palette): string {
  const roles: Record<string, string> = {};
  for (const [role, src] of Object.entries(PALETTE_ROLES)) roles[role] = base.map[src] ?? src;
  return (
    JSON.stringify(
      {
        name: 'Моя палитра',
        background: base.background,
        roles,
        _help:
          'roles: bgLight/bgMid/bgDark — цвета фона (фоновые объекты монохромны в них), accent1..3 — цвета главных объектов, ink — контур, paper — белый. Вместо roles можно передать map: { "#исходный": "#новый" }.',
      },
      null,
      2,
    ) + '\n'
  );
}
