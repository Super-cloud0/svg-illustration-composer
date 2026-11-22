import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { LibraryPanel } from './components/LibraryPanel';
import { ScenarioPanel } from './components/ScenarioPanel';
import { buildSvg } from './core/export';
import { autoLayout, TEMPLATES, type LayoutObject } from './core/layout';
import { matchPhrase, promoteBackground, type Pick } from './core/matching';
import { BUILTIN_PALETTES, paletteTemplate } from './core/palettes';
import { parsePaletteJson } from './core/recolor';
import type { Composition, CompositionItem, LibraryObject, Palette, SizeSet, TemplateId } from './core/types';
import { findEntry, makeResolver, useLibraryLoader, useObjects } from './state/library';
import { moveLayer, newUid, updateItem, useComposition } from './state/store';

const FORMATS = [
  { w: 1200, h: 630, name: '1200×630 · обложка' },
  { w: 1200, h: 1200, name: '1200×1200 · квадрат' },
  { w: 1080, h: 1350, name: '1080×1350 · портрет' },
  { w: 1000, h: 1000, name: '1000×1000' },
  { w: 800, h: 1200, name: '800×1200' },
];

const KEY_STORAGE = 'svg-composer.groqKey';
const PALETTE_STORAGE = 'svg-composer.customPalettes';

const readLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

const INITIAL: Composition = { width: 1200, height: 630, size: 'L', paletteId: 'purple', scale: 0.4, items: [] };

export default function App() {
  const loader = useLibraryLoader();
  const { all, upload } = useObjects();
  const { comp, set, commit, undo, redo, canUndo, canRedo } = useComposition(INITIAL);
  const [selected, setSelected] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateId>('title');
  const [seed, setSeed] = useState(0);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [tab, setTab] = useState<'scenario' | 'library'>('scenario');
  const [toast, setToast] = useState<{ msg: string; kind: 'error' | 'info' } | null>(null);
  const [groqKey, setGroqKey] = useState(() => readLS(KEY_STORAGE) ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(() => {
    try {
      return JSON.parse(readLS(PALETTE_STORAGE) ?? '[]');
    } catch {
      return [];
    }
  });
  const paletteInput = useRef<HTMLInputElement>(null);

  const palettes = useMemo(() => [...BUILTIN_PALETTES, ...customPalettes], [customPalettes]);
  const palette = palettes.find((p) => p.id === comp.paletteId) ?? palettes[0];
  const resolver = useMemo(() => makeResolver(all), [all]);
  const isPreset = FORMATS.some((f) => f.w === comp.width && f.h === comp.height);

  const notify = useCallback((msg: string, kind: 'error' | 'info' = 'info') => setToast({ msg, kind }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Run auto-layout for a list of (key, variant) and replace the composition items. */
  const layout = useCallback(
    (objs: { key: string; variant: 'main' | 'bg' }[], base: Composition, tpl: TemplateId, sd: number): Composition => {
      const lo: LayoutObject[] = [];
      for (const o of objs) {
        const e = findEntry(all, o.key, o.variant, base.size);
        if (!e) continue;
        const u = resolver.unit(e);
        lo.push({ key: o.key, variant: o.variant, w: e.width * u, h: e.height * u });
      }
      const res = autoLayout(lo, base.width, base.height, tpl, sd);
      const items: CompositionItem[] = res.items.map((it) => ({ ...it, uid: newUid() }));
      return { ...base, scale: res.scale, items };
    },
    [all, resolver],
  );

  const applyPicks = useCallback(
    (p: Pick[], source: string) => {
      setPicks(p);
      setSelected(null);
      set(layout(p, comp, template, seed));
      notify(`Собрано: ${p.length} объект(а) · ${source}`);
    },
    [comp, layout, notify, set, template, seed],
  );

  const relayout = (tpl = template, sd = seed, base = comp) => {
    if (!base.items.length) return set(base);
    set(layout(base.items.map((i) => ({ key: i.key, variant: i.variant })), base, tpl, sd));
  };

  // First run: build a demo composition once the SVGs are loaded.
  const booted = useRef(false);
  useEffect(() => {
    if (!loader.ready || booted.current) return;
    booted.current = true;
    const p = promoteBackground(matchPhrase('учёба и концентрация'), (k) => {
      const e = findEntry(all, k, 'main', comp.size);
      return e ? e.width * e.height : 0;
    });
    setPicks(p);
    set(layout(p, comp, template, seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader.ready]);

  // ---- object operations ----
  const sel = comp.items.find((i) => i.uid === selected);
  const duplicate = () => {
    if (!sel) return;
    const copy = { ...sel, uid: newUid(), x: sel.x + 40, y: sel.y + 40 };
    const i = comp.items.indexOf(sel);
    const items = [...comp.items];
    items.splice(i + 1, 0, copy);
    set({ ...comp, items });
    setSelected(copy.uid);
  };
  const remove = () => {
    if (!sel) return;
    set({ ...comp, items: comp.items.filter((i) => i.uid !== sel.uid) });
    setSelected(null);
  };
  const toggleVariant = () => {
    if (!sel) return;
    const e = resolver.entry(sel, comp);
    if (e?.custom) return;
    set(updateItem(comp, sel.uid, { variant: sel.variant === 'main' ? 'bg' : 'main' }));
  };
  const addObject = (o: LibraryObject) => {
    const unit = resolver.unit(o);
    let scale = comp.scale;
    if (!comp.items.length) scale = Math.min(1, (0.5 * Math.min(comp.width, comp.height)) / (Math.max(o.width, o.height) * unit));
    const item: CompositionItem = { uid: newUid(), key: o.key, variant: o.custom ? 'main' : o.type, x: comp.width / 2, y: comp.height / 2, rotation: 0 };
    set({ ...comp, scale: Math.round(scale * 1e4) / 1e4, items: [...comp.items, item] });
    setSelected(item.uid);
  };
  /** One factor for all objects; positions scale around the group's center so the layout holds. */
  const setScale = (scale: number, transient: boolean) => {
    const n = comp.items.length || 1;
    const cx = comp.items.reduce((s, i) => s + i.x, 0) / n;
    const cy = comp.items.reduce((s, i) => s + i.y, 0) / n;
    const f = scale / comp.scale;
    set(
      { ...comp, scale, items: comp.items.map((i) => ({ ...i, x: Math.round(cx + (i.x - cx) * f), y: Math.round(cy + (i.y - cy) * f) })) },
      transient,
    );
  };

  // ---- export ----
  const svgText = () => buildSvg(comp, palette, resolver);
  const download = () => {
    const blob = new Blob([svgText()], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `composition-${comp.width}x${comp.height}-${comp.size}-${palette.id}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(svgText());
      notify('SVG скопирован в буфер обмена');
    } catch {
      notify('Браузер не дал доступ к буферу обмена', 'error');
    }
  };

  // ---- palettes ----
  const uploadPalette = async (file: File) => {
    try {
      const p = parsePaletteJson(await file.text(), `custom-${Date.now().toString(36)}`);
      const next = [...customPalettes.filter((c) => c.id !== p.id), p];
      setCustomPalettes(next);
      writeLS(PALETTE_STORAGE, JSON.stringify(next));
      set({ ...comp, paletteId: p.id });
      notify(`Палитра «${p.name}» применена`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const downloadTemplate = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([paletteTemplate(palette)], { type: 'application/json' }));
    a.download = 'palette-template.json';
    a.click();
  };

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (!sel) return;
      if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        remove();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicate();
      } else if (e.key === ']' || e.code === 'BracketRight') {
        set(moveLayer(comp, sel.uid, mod ? 'front' : 1));
      } else if (e.key === '[' || e.code === 'BracketLeft') {
        set(moveLayer(comp, sel.uid, mod ? 'back' : -1));
      } else if (k === 'r' && !mod) {
        let r = sel.rotation + (e.shiftKey ? -15 : 15);
        if (r > 180) r -= 360;
        if (r < -180) r += 360;
        set(updateItem(comp, sel.uid, { rotation: r }));
      } else if (k === 'b' && !mod) {
        toggleVariant();
      } else if (k === 'escape') {
        setSelected(null);
      } else if (k.startsWith('arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        set(updateItem(comp, sel.uid, { x: sel.x + dx, y: sel.y + dy }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const candidates = all.filter((o) => o.type === 'main' && (o.custom || o.size === comp.size));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          SVG Illustration Composer
        </div>
        <div className="controls">
          <label className="field">
            <span>Формат</span>
            <select
              value={isPreset ? `${comp.width}x${comp.height}` : 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') return; // free size is set in the inputs next to it
                const [w, h] = e.target.value.split('x').map(Number);
                relayout(template, seed, { ...comp, width: w, height: h });
              }}
            >
              {FORMATS.map((f) => (
                <option key={f.name} value={`${f.w}x${f.h}`}>
                  {f.name}
                </option>
              ))}
              <option value="custom">Свой размер…</option>
            </select>
          </label>
          <CustomSize comp={comp} onApply={(w, h) => relayout(template, seed, { ...comp, width: w, height: h })} />
          <div className="field">
            <span>Размер</span>
            <div className="segmented">
              {(['L', 'S'] as SizeSet[]).map((s) => (
                <button
                  key={s}
                  className={comp.size === s ? 'on' : ''}
                  onClick={() => set({ ...comp, size: s })}
                  title={s === 'L' ? 'Детальные объекты для крупных иллюстраций' : 'Упрощённые объекты для небольших иллюстраций'}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Палитра</span>
            <div className="swatches">
              {palettes.map((p) => (
                <button key={p.id} className={`swatch ${p.id === palette.id ? 'on' : ''}`} title={p.name} onClick={() => set({ ...comp, paletteId: p.id })}>
                  <i style={{ background: p.background }} />
                  <i style={{ background: p.map['#f9ecb0'] ?? '#f9ecb0' }} />
                  <i style={{ background: p.map['#f9a3aa'] ?? '#f9a3aa' }} />
                </button>
              ))}
              <button className="icon-btn" title="Загрузить палитру (JSON)" onClick={() => paletteInput.current?.click()}>
                ＋
              </button>
              <button className="icon-btn" title="Скачать шаблон палитры" onClick={downloadTemplate}>
                ⤓
              </button>
              <input
                ref={paletteInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPalette(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={copy} disabled={!comp.items.length}>
            Копировать SVG
          </button>
          <button className="btn primary" onClick={download} disabled={!comp.items.length}>
            Скачать SVG
          </button>
          <button className="icon-btn" title="Настройки AI" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel left">
          <div className="tabs">
            <button className={tab === 'scenario' ? 'on' : ''} onClick={() => setTab('scenario')}>
              Сборка
            </button>
            <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
              Библиотека
            </button>
          </div>
          <div className="panel-scroll">
            {tab === 'scenario' ? (
              <ScenarioPanel
                candidates={candidates}
                hasKey={!!groqKey}
                groqKey={groqKey}
                picks={picks}
                onPicks={applyPicks}
                onOpenSettings={() => setSettingsOpen(true)}
                notify={notify}
              />
            ) : (
              <LibraryPanel
                objects={all}
                size={comp.size}
                onAdd={addObject}
                onUpload={async (files) => {
                  const errors = await upload(files);
                  notify(errors.length ? errors.join('; ') : 'SVG добавлены в библиотеку', errors.length ? 'error' : 'info');
                }}
              />
            )}
          </div>
        </aside>

        <section className="center">
          <div className="toolbar">
            <div className="segmented">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className={template === t.id ? 'on' : ''}
                  title={t.hint}
                  onClick={() => {
                    setTemplate(t.id);
                    relayout(t.id, seed);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <button
              className="btn"
              disabled={!comp.items.length}
              onClick={() => {
                setSeed(seed + 1);
                relayout(template, seed + 1);
              }}
              title="Другой вариант раскладки"
            >
              ⟳ Перемешать
            </button>
            <span className="spacer" />
            <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Отменить (Ctrl+Z)">
              ↶
            </button>
            <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)">
              ↷
            </button>
          </div>
          {loader.ready ? (
            <Canvas
              comp={comp}
              palette={palette}
              resolver={resolver}
              selected={selected}
              template={template}
              showGuide={showGuide}
              onSelect={setSelected}
              onChange={set}
              onCommit={commit}
            />
          ) : (
            <div className="stage loading">
              {loader.error ? `Ошибка: ${loader.error}` : `Загрузка библиотеки… ${loader.loaded}/${loader.total}`}
            </div>
          )}
          <div className="statusbar">
            <span>
              {comp.width}×{comp.height} · размер {comp.size} · {palette.name} · масштаб {Math.round(comp.scale * 100)}% · объектов {comp.items.length}
            </span>
            <span className="muted">Del — удалить · Ctrl+D — дубль · [ ] — слои · R — поворот · B — главный/фон · стрелки — сдвиг</span>
          </div>
        </section>

        <Inspector
          comp={comp}
          resolver={resolver}
          selected={selected}
          showGuide={showGuide}
          onSelect={setSelected}
          onChange={set}
          onCommit={commit}
          onDuplicate={duplicate}
          onDelete={remove}
          onToggleVariant={toggleVariant}
          onScale={setScale}
          onShowGuide={setShowGuide}
        />
      </main>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
      {settingsOpen && (
        <Settings
          value={groqKey}
          onClose={() => setSettingsOpen(false)}
          onSave={(k) => {
            setGroqKey(k);
            writeLS(KEY_STORAGE, k || null);
            setSettingsOpen(false);
            notify(k ? 'Ключ Groq сохранён в localStorage' : 'Ключ удалён');
          }}
        />
      )}
    </div>
  );
}

function CustomSize({ comp, onApply }: { comp: Composition; onApply(w: number, h: number): void }) {
  const [w, setW] = useState(comp.width);
  const [h, setH] = useState(comp.height);
  useEffect(() => {
    setW(comp.width);
    setH(comp.height);
  }, [comp.width, comp.height]);
  const valid = w >= 100 && h >= 100 && w <= 5000 && h <= 5000;
  return (
    <form
      className="custom-size"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply(Math.round(w), Math.round(h));
      }}
    >
      <input type="number" value={w} min={100} max={5000} onChange={(e) => setW(+e.target.value)} aria-label="Ширина" />
      <span>×</span>
      <input type="number" value={h} min={100} max={5000} onChange={(e) => setH(+e.target.value)} aria-label="Высота" />
      <button className="icon-btn" type="submit" disabled={!valid || (w === comp.width && h === comp.height)} title="Применить размер">
        ✓
      </button>
    </form>
  );
}

function Settings({ value, onSave, onClose }: { value: string; onSave(k: string): void; onClose(): void }) {
  const [k, setK] = useState(value);
  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>AI-подбор объектов (необязательно)</h3>
        <p className="hint">
          Для сценария «Метафора» можно подключить Groq (модель llama-3.3-70b-versatile). Модель только выбирает ID объектов из library.json и объясняет
          выбор — изображения не генерируются. Ключ хранится только в localStorage этого браузера, запрос идёт напрямую в api.groq.com.
        </p>
        <label className="label" htmlFor="groq">
          Groq API key
        </label>
        <input id="groq" type="password" value={k} onChange={(e) => setK(e.target.value.trim())} placeholder="gsk_…" autoComplete="off" />
        <div className="row end">
          {value && (
            <button className="btn danger" onClick={() => onSave('')}>
              Удалить ключ
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={() => onSave(k)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
