import type { AssetResolver } from '../core/export';
import type { Composition } from '../core/types';
import { moveLayer, updateItem } from '../state/store';

interface Props {
  comp: Composition;
  resolver: AssetResolver;
  selected: string | null;
  showGuide: boolean;
  onSelect(uid: string | null): void;
  onChange(next: Composition, transient?: boolean): void;
  onCommit(): void;
  onDuplicate(): void;
  onDelete(): void;
  onToggleVariant(): void;
  onScale(scale: number, transient: boolean): void;
  onShowGuide(v: boolean): void;
}

export function Inspector(p: Props) {
  const { comp, resolver, selected } = p;
  const item = comp.items.find((i) => i.uid === selected);
  const entry = item && resolver.entry(item, comp);
  const pct = Math.round(comp.scale * 100);
  const hintS = comp.size === 'L' && comp.scale < 0.45;
  const hintL = comp.size === 'S' && comp.scale > 0.9;

  return (
    <aside className="panel right">
      <div className="panel-section">
        <div className="label">Объект</div>
        {item && entry ? (
          <>
            <div className="obj-title">
              {entry.name}
              <span className="badge">{entry.custom ? 'загружен' : entry.type === 'main' ? 'главный' : 'фоновый'}</span>
            </div>
            {!entry.custom && (
              <div className="segmented full">
                <button className={item.variant === 'main' ? 'on' : ''} onClick={() => item.variant !== 'main' && p.onToggleVariant()}>
                  Главный
                </button>
                <button className={item.variant === 'bg' ? 'on' : ''} onClick={() => item.variant !== 'bg' && p.onToggleVariant()}>
                  Фоновый
                </button>
              </div>
            )}
            <label className="label">Поворот: {item.rotation}°</label>
            <input
              type="range"
              min={-180}
              max={180}
              value={item.rotation}
              onChange={(e) => p.onChange(updateItem(comp, item.uid, { rotation: +e.target.value }), true)}
              onPointerUp={p.onCommit}
              onKeyUp={p.onCommit}
            />
            <div className="row two">
              <label className="num">
                X
                <input type="number" value={item.x} onChange={(e) => p.onChange(updateItem(comp, item.uid, { x: +e.target.value }))} />
              </label>
              <label className="num">
                Y
                <input type="number" value={item.y} onChange={(e) => p.onChange(updateItem(comp, item.uid, { y: +e.target.value }))} />
              </label>
            </div>
            <div className="label">Слой</div>
            <div className="row tools">
              <button className="icon-btn" title="На задний план (Ctrl+[)" onClick={() => p.onChange(moveLayer(comp, item.uid, 'back'))}>
                ⇊
              </button>
              <button className="icon-btn" title="Назад ([)" onClick={() => p.onChange(moveLayer(comp, item.uid, -1))}>
                ↓
              </button>
              <button className="icon-btn" title="Вперёд (])" onClick={() => p.onChange(moveLayer(comp, item.uid, 1))}>
                ↑
              </button>
              <button className="icon-btn" title="На передний план (Ctrl+])" onClick={() => p.onChange(moveLayer(comp, item.uid, 'front'))}>
                ⇈
              </button>
            </div>
            <div className="row">
              <button className="btn" onClick={p.onDuplicate} title="Ctrl+D">
                Дублировать
              </button>
              <button className="btn danger" onClick={p.onDelete} title="Delete">
                Удалить
              </button>
            </div>
          </>
        ) : (
          <p className="hint">Выберите объект на холсте. Перетаскивание — мышью, поворот — за круглый маркер.</p>
        )}
      </div>

      <div className="panel-section">
        <div className="label">Масштаб композиции: {pct}%</div>
        <input
          type="range"
          min={10}
          max={125}
          value={pct}
          onChange={(e) => p.onScale(+e.target.value / 100, true)}
          onPointerUp={p.onCommit}
          onKeyUp={p.onCommit}
        />
        <p className="hint">
          Один коэффициент для всех объектов — пропорции между ними не меняются.
          {hintS && <b> На таком масштабе лучше смотрится размер S.</b>}
          {hintL && <b> На таком масштабе лучше смотрится размер L.</b>}
        </p>
        <label className="check">
          <input type="checkbox" checked={p.showGuide} onChange={(e) => p.onShowGuide(e.target.checked)} /> Показывать зону заголовка
        </label>
      </div>

      <div className="panel-section grow">
        <div className="label">Слои ({comp.items.length})</div>
        <ul className="layers">
          {[...comp.items].reverse().map((it) => {
            const e = resolver.entry(it, comp);
            return (
              <li key={it.uid} className={it.uid === selected ? 'on' : ''} onClick={() => p.onSelect(it.uid)}>
                <span>{e?.name ?? it.key}</span>
                <span className="muted">{e?.custom ? 'свой' : it.variant === 'main' ? 'главный' : 'фон'}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
