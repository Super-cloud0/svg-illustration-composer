import { useEffect, useMemo, useState } from 'react';
import libraryJson from '../data/library.json';
import { extractColors, parseSvg, sanitizeSvg } from '../core/svg';
import type { AssetResolver } from '../core/export';
import type { Composition, CompositionItem, Library, LibraryObject, SizeSet, SvgAsset } from '../core/types';

export const LIBRARY = libraryJson as Library;
const BASE = `${import.meta.env.BASE_URL}library/`;

/** Parsed SVG content by file name; library files are fetched once, uploads are added in memory. */
const svgCache = new Map<string, SvgAsset>();

async function fetchSvg(file: string): Promise<void> {
  if (svgCache.has(file)) return;
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`Не удалось загрузить ${file}`);
  svgCache.set(file, parseSvg(await res.text()));
}

/** Loads every library SVG (both sets, ~1.5 MB raw, gzip-friendly) once at startup. */
export function useLibraryLoader() {
  const [state, setState] = useState<{ ready: boolean; loaded: number; error?: string }>({ ready: false, loaded: 0 });
  useEffect(() => {
    let loaded = 0;
    const files = [...LIBRARY.objects.map((o) => o.file), ...LIBRARY.decor.map((d) => d.file)];
    Promise.all(
      files.map((f) =>
        fetchSvg(f).then(() => {
          loaded++;
          setState((s) => ({ ...s, loaded }));
        }),
      ),
    )
      .then(() => setState({ ready: true, loaded }))
      .catch((e: Error) => setState({ ready: false, loaded, error: e.message }));
  }, []);
  return { ...state, total: LIBRARY.objects.length + LIBRARY.decor.length };
}

/** Library objects including user uploads (kept in memory for the session). */
export function useObjects() {
  const [custom, setCustom] = useState<LibraryObject[]>([]);
  const all = useMemo(() => [...LIBRARY.objects, ...custom], [custom]);

  async function upload(files: FileList | File[]): Promise<string[]> {
    const errors: string[] = [];
    const added: LibraryObject[] = [];
    for (const file of Array.from(files)) {
      try {
        const id = `custom_${Date.now().toString(36)}_${added.length}`;
        const text = sanitizeSvg(await file.text(), `${id}_`);
        const svg = parseSvg(text);
        const base = file.name.replace(/\.svg$/i, '');
        svgCache.set(id, svg);
        added.push({
          id,
          key: id,
          name: base,
          nameEn: base,
          size: 'L',
          type: 'main',
          file: id,
          width: svg.viewBox[2],
          height: svg.viewBox[3],
          tags: base.toLowerCase().split(/[\s_\-.]+/).filter(Boolean),
          colors: extractColors(text),
          custom: true,
        });
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (added.length) setCustom((c) => [...c, ...added]);
    return errors;
  }

  return { all, custom, upload };
}

export function makeResolver(all: LibraryObject[]): AssetResolver {
  return {
    entry: (item: CompositionItem, comp: Composition) => findEntry(all, item.key, item.variant, comp.size),
    svg: (file) => svgCache.get(file),
    unit: (entry) => (entry.custom ? 1 : LIBRARY.sizeScale[entry.size]),
    decor: (id) => LIBRARY.decor.find((d) => d.id === id),
  };
}

/** Resolve object kind + variant in the requested size set (custom uploads have one variant). */
export function findEntry(all: LibraryObject[], key: string, variant: 'main' | 'bg', size: SizeSet) {
  return (
    all.find((o) => o.key === key && o.type === variant && o.size === size) ??
    all.find((o) => o.key === key && o.custom) ??
    all.find((o) => o.key === key && o.size === size)
  );
}

export const assetUrl = (o: LibraryObject) => (o.custom ? undefined : BASE + o.file);
export const getSvg = (file: string) => svgCache.get(file);
