export type SizeSet = 'L' | 'S';
export type Variant = 'main' | 'bg';
export type TemplateId = 'title' | 'offset' | 'collected';

/** One entry of library.json — metadata about a single source SVG file. */
export interface LibraryObject {
  id: string; // e.g. "L_main_book" — also the file name without extension
  key: string; // object kind shared by all variants, e.g. "book"
  name: string; // Russian display name
  nameEn: string;
  size: SizeSet;
  type: Variant;
  file: string; // path relative to public/library/
  width: number; // viewBox width (native units)
  height: number;
  tags: string[];
  colors: string[]; // normalized #rrggbb fill/stroke colors used in the file
  custom?: boolean; // uploaded by the user at runtime
}

export interface Library {
  generatedAt: string;
  /** Uniform per-set factor that brings each set to the same visual footprint (L = 1). */
  sizeScale: Record<SizeSet, number>;
  sourcePalette: string[];
  objects: LibraryObject[];
}

/** Parsed SVG ready to be embedded: inner markup + viewBox. */
export interface SvgAsset {
  viewBox: [number, number, number, number];
  inner: string;
}

export interface CompositionItem {
  uid: string;
  key: string; // object kind ("book") or custom asset id
  variant: Variant;
  x: number; // center, canvas units
  y: number;
  rotation: number; // degrees
}

export interface Composition {
  width: number;
  height: number;
  size: SizeSet;
  paletteId: string;
  /** One scale factor for every object (in L units) — keeps relative proportions. */
  scale: number;
  items: CompositionItem[]; // paint order: first = back
}

export interface Palette {
  id: string;
  name: string;
  background: string;
  /** source color (from the assets) -> target color */
  map: Record<string, string>;
  custom?: boolean;
}
