import { useRef, useState } from 'react';
import type { LibraryObject, SizeSet, Variant } from '../core/types';
import { assetUrl, getSvg } from '../state/library';

interface Props {
  objects: LibraryObject[];
  size: SizeSet;
  onAdd(o: LibraryObject): void;
  onUpload(files: FileList): void;
}

function Thumb({ o }: { o: LibraryObject }) {
  const url = assetUrl(o);
  if (url) return <img src={url} alt={o.name} loading="lazy" draggable={false} />;
  const svg = getSvg(o.file);
  if (!svg) return null;
  return <svg viewBox={svg.viewBox.join(' ')} dangerouslySetInnerHTML={{ __html: svg.inner }} />;
}

export function LibraryPanel({ objects, size, onAdd, onUpload }: Props) {
  const [variant, setVariant] = useState<Variant>('main');
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase().replace(/ё/g, 'е');
  const list = objects.filter(
    (o) =>
      (o.custom || (o.size === size && o.type === variant)) &&
      (!query || o.tags.some((t) => t.replace(/ё/g, 'е').includes(query)) || o.name.toLowerCase().includes(query)),
  );

  return (
    <div className="panel-section">
      <div className="row">
        <div className="segmented">
          <button className={variant === 'main' ? 'on' : ''} onClick={() => setVariant('main')}>
            Главные
          </button>
          <button className={variant === 'bg' ? 'on' : ''} onClick={() => setVariant('bg')}>
            Фоновые
          </button>
        </div>
        <input className="search" placeholder="Поиск: лампа, music…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid">
        {list.map((o) => (
          <button key={o.id} className="tile" onClick={() => onAdd(o)} title={`${o.name} · ${o.size} · ${o.custom ? 'загружен' : o.type === 'main' ? 'главный' : 'фоновый'}\nТеги: ${o.tags.join(', ')}`}>
            <Thumb o={o} />
            <span>{o.name}</span>
          </button>
        ))}
        {list.length === 0 && <p className="hint">Ничего не найдено</p>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onUpload(e.target.files);
          e.target.value = '';
        }}
      />
      <button className="btn ghost full" onClick={() => fileRef.current?.click()}>
        ＋ Загрузить свои SVG
      </button>
      <p className="hint">Загруженные SVG очищаются от скриптов, используются в своих единицах и с тем же общим масштабом, что и остальные объекты.</p>
    </div>
  );
}
