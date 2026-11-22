import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { itemTransform, type AssetResolver } from '../core/export';
import { recolorMarkup } from '../core/recolor';
import type { Composition, Palette, TemplateId } from '../core/types';
import { updateItem } from '../state/store';

interface Props {
  comp: Composition;
  palette: Palette;
  resolver: AssetResolver;
  selected: string | null;
  template: TemplateId;
  showGuide: boolean;
  onSelect(uid: string | null): void;
  onChange(next: Composition, transient?: boolean): void;
  onCommit(): void;
}

// Recolored markup cache: file + palette -> markup (recoloring 60 KB strings on every drag frame would be wasteful).
const recolorCache = new Map<string, string>();
function recolored(file: string, inner: string, palette: Palette) {
  const key = `${file}|${palette.id}|${JSON.stringify(palette.map)}`;
  let s = recolorCache.get(key);
  if (s === undefined) {
    s = recolorMarkup(inner, palette.map);
    recolorCache.set(key, s);
  }
  return s;
}

const ObjectLayer = memo(function ObjectLayer(p: { uid: string; markup: string; transform: string; onDown(e: React.PointerEvent, uid: string): void }) {
  return (
    <g
      data-uid={p.uid}
      transform={p.transform}
      className="obj"
      onPointerDown={(e) => p.onDown(e, p.uid)}
      dangerouslySetInnerHTML={{ __html: p.markup }}
    />
  );
});

type Gesture =
  | { kind: 'move'; uid: string; dx: number; dy: number }
  | { kind: 'rotate'; uid: string; cx: number; cy: number };

export function Canvas({ comp, palette, resolver, selected, template, showGuide, onSelect, onChange, onCommit }: Props) {
  const W = comp.width,
    H = comp.height;
  const margin = Math.round(Math.max(W, H) * 0.12);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 800, h: 500 });
  const gesture = useRef<Gesture | null>(null);
  const compRef = useRef(comp);
  compRef.current = comp;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vbW = W + margin * 2,
    vbH = H + margin * 2;
  const k = Math.min(box.w / vbW, box.h / vbH);
  const px = 1 / (k || 1); // canvas units per screen pixel

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: pt.x, y: pt.y };
  };

  const onObjectDown = useMemo(
    () => (e: React.PointerEvent, uid: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect(uid);
      const it = compRef.current.items.find((i) => i.uid === uid);
      if (!it) return;
      const p = toCanvas(e);
      gesture.current = { kind: 'move', uid, dx: p.x - it.x, dy: p.y - it.y };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelect],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const p = toCanvas(e);
      const c = compRef.current;
      if (g.kind === 'move') {
        onChange(updateItem(c, g.uid, { x: Math.round(p.x - g.dx), y: Math.round(p.y - g.dy) }), true);
      } else {
        let a = (Math.atan2(p.y - g.cy, p.x - g.cx) * 180) / Math.PI + 90;
        if (a > 180) a -= 360;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        onChange(updateItem(c, g.uid, { rotation: Math.round(a) }), true);
      }
    };
    const up = () => {
      if (gesture.current) {
        gesture.current = null;
        onCommit();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, onCommit]);

  const sel = comp.items.find((i) => i.uid === selected);
  const selEntry = sel && resolver.entry(sel, comp);
  const selSize = selEntry && {
    w: selEntry.width * comp.scale * resolver.unit(selEntry),
    h: selEntry.height * comp.scale * resolver.unit(selEntry),
  };

  // Heading safe-zone guide for the "Под заголовок" template (editor only, never exported).
  const landscape = W / H > 1.2;
  const guide = landscape ? { x: W * 0.06, y: H * 0.1, w: W * 0.36, h: H * 0.42 } : { x: W * 0.08, y: H * 0.07, w: W * 0.84, h: H * 0.28 };

  return (
    <div className="stage" ref={wrapRef}>
      <svg
        ref={svgRef}
        width={vbW * k}
        height={vbH * k}
        viewBox={`${-margin} ${-margin} ${vbW} ${vbH}`}
        onPointerDown={() => onSelect(null)}
        className="stage-svg"
      >
        <defs>
          <clipPath id="editor-canvas-clip">
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill={palette.background} />
        {/* Same as the export: objects are clipped to the frame, nothing renders outside it. */}
        <g clipPath="url(#editor-canvas-clip)">
          {comp.items.map((it) => {
            const entry = resolver.entry(it, comp);
            const svg = entry && resolver.svg(entry.file);
            if (!entry || !svg) return null;
            return (
              <ObjectLayer
                key={it.uid}
                uid={it.uid}
                markup={recolored(entry.file, svg.inner, palette)}
                transform={itemTransform(it, svg, comp.scale * resolver.unit(entry))}
                onDown={onObjectDown}
              />
            );
          })}
        </g>
        <rect x={0} y={0} width={W} height={H} fill="none" className="frame" strokeWidth={px} pointerEvents="none" />
        {showGuide && template === 'title' && (
          <g pointerEvents="none" className="guide">
            <rect x={guide.x} y={guide.y} width={guide.w} height={guide.h} strokeWidth={px * 1.5} strokeDasharray={`${px * 6} ${px * 4}`} />
            <text x={guide.x + px * 12} y={guide.y + px * 24} fontSize={px * 13}>
              Зона заголовка
            </text>
          </g>
        )}
        {sel && selSize && (
          <g transform={`translate(${sel.x} ${sel.y}) rotate(${sel.rotation})`} className="selection">
            <rect x={-selSize.w / 2} y={-selSize.h / 2} width={selSize.w} height={selSize.h} strokeWidth={px * 1.5} pointerEvents="none" />
            <line x1={0} y1={-selSize.h / 2} x2={0} y2={-selSize.h / 2 - px * 28} strokeWidth={px * 1.5} pointerEvents="none" />
            <circle
              cx={0}
              cy={-selSize.h / 2 - px * 28}
              r={px * 7}
              strokeWidth={px * 1.5}
              className="rotate-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                gesture.current = { kind: 'rotate', uid: sel.uid, cx: sel.x, cy: sel.y };
              }}
            >
              <title>Повернуть (Shift — шаг 15°)</title>
            </circle>
          </g>
        )}
      </svg>
    </div>
  );
}
