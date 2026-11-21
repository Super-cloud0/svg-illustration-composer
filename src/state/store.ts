import { useCallback, useReducer } from 'react';
import type { Composition, CompositionItem } from '../core/types';

/** Undo/redo history around an immutable Composition. */
interface History {
  past: Composition[];
  present: Composition;
  future: Composition[];
  /** snapshot taken at the start of a continuous gesture (drag / slider) */
  gestureStart: Composition | null;
}

type Action =
  | { type: 'set'; next: Composition; transient?: boolean }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 100;

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'set':
      if (a.transient) {
        // During a gesture only `present` changes; history is written on commit.
        return { ...h, present: a.next, gestureStart: h.gestureStart ?? h.present };
      }
      return { past: [...h.past, h.present].slice(-LIMIT), present: a.next, future: [], gestureStart: null };
    case 'commit':
      if (!h.gestureStart || h.gestureStart === h.present) return { ...h, gestureStart: null };
      return { past: [...h.past, h.gestureStart].slice(-LIMIT), present: h.present, future: [], gestureStart: null };
    case 'undo': {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], gestureStart: null };
    }
    case 'redo': {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), gestureStart: null };
    }
  }
}

export function useComposition(initial: Composition) {
  const [h, dispatch] = useReducer(reducer, { past: [], present: initial, future: [], gestureStart: null });
  return {
    comp: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    set: useCallback((next: Composition, transient = false) => dispatch({ type: 'set', next, transient }), []),
    commit: useCallback(() => dispatch({ type: 'commit' }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
  };
}

let counter = 0;
export const newUid = () => `o${Date.now().toString(36)}${(counter++).toString(36)}`;

export function updateItem(comp: Composition, uid: string, patch: Partial<CompositionItem>): Composition {
  return { ...comp, items: comp.items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)) };
}

export function moveLayer(comp: Composition, uid: string, dir: 1 | -1 | 'front' | 'back'): Composition {
  const items = [...comp.items];
  const i = items.findIndex((it) => it.uid === uid);
  if (i < 0) return comp;
  const [it] = items.splice(i, 1);
  const j = dir === 'front' ? items.length : dir === 'back' ? 0 : Math.max(0, Math.min(items.length, i + dir));
  items.splice(j, 0, it);
  return { ...comp, items };
}
