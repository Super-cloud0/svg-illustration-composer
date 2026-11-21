import { useState } from 'react';
import { CATALOG, matchPhrase, parseComponents, promoteBackground, type Pick } from '../core/matching';
import { suggestWithGroq } from '../core/llm';
import type { LibraryObject } from '../core/types';

interface Props {
  candidates: LibraryObject[]; // main objects of the current size set
  hasKey: boolean;
  groqKey: string;
  picks: Pick[];
  onPicks(picks: Pick[], source: string): void;
  onOpenSettings(): void;
  notify(msg: string, kind?: 'error' | 'info'): void;
}

const METAPHORS = ['учёба и концентрация', 'финансовая грамотность', 'удалённая работа и созвоны', 'командное решение задач', 'уютный вечер с книгой'];
const COMPONENT_EXAMPLES = ['книга, наушники, лампа', 'кошелёк, 2 монеты, телефон', 'папка, ручка, фоновые цветы'];

export function ScenarioPanel({ candidates, hasKey, groqKey, picks, onPicks, onOpenSettings, notify }: Props) {
  const [mode, setMode] = useState<'metaphor' | 'components'>('metaphor');
  const [phrase, setPhrase] = useState('учёба и концентрация');
  const [components, setComponents] = useState('книга, наушники, лампа');
  const [busy, setBusy] = useState(false);
  const keys = [...new Set(candidates.map((c) => c.key))];
  const areaOf = (key: string) => {
    const c = candidates.find((o) => o.key === key);
    return c ? c.width * c.height : 0;
  };

  const runDictionary = (text = phrase) => {
    if (!text.trim()) return;
    onPicks(promoteBackground(matchPhrase(text, keys), areaOf), 'словарь синонимов');
  };

  const runAi = async () => {
    if (!phrase.trim()) return;
    setBusy(true);
    try {
      const picks = await suggestWithGroq(phrase, groqKey, candidates);
      onPicks(promoteBackground(picks, areaOf), 'AI (Groq)');
    } catch (e) {
      runDictionary();
      notify(`${(e as Error).message}. Использован словарь синонимов.`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runComponents = (text = components) => {
    const { picks, unknown } = parseComponents(text, keys);
    if (unknown.length) notify(`Не найдено в библиотеке: ${unknown.join(', ')}`, 'error');
    if (picks.length) onPicks(picks, 'список компонентов');
  };

  return (
    <div className="panel-section">
      <div className="segmented full">
        <button className={mode === 'metaphor' ? 'on' : ''} onClick={() => setMode('metaphor')}>
          Метафора
        </button>
        <button className={mode === 'components' ? 'on' : ''} onClick={() => setMode('components')}>
          Компоненты
        </button>
      </div>

      {mode === 'metaphor' ? (
        <>
          <label className="label" htmlFor="phrase">
            Заголовок или метафора
          </label>
          <textarea
            id="phrase"
            rows={2}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runDictionary();
              }
            }}
            placeholder="например, «финансовая грамотность»"
          />
          <div className="chips">
            {METAPHORS.map((m) => (
              <button
                key={m}
                className="chip"
                onClick={() => {
                  setPhrase(m);
                  runDictionary(m);
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => runDictionary()}>
              Собрать
            </button>
            {hasKey ? (
              <button className="btn" onClick={runAi} disabled={busy} title="Groq выберет объекты из библиотеки — без генерации изображений">
                {busy ? 'Думаю…' : '✦ Подобрать с AI'}
              </button>
            ) : (
              <button className="btn ghost" onClick={onOpenSettings} title="Добавьте ключ Groq в настройках">
                ✦ AI-подбор…
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <label className="label" htmlFor="components">
            Названия компонентов через запятую
          </label>
          <textarea
            id="components"
            rows={2}
            value={components}
            onChange={(e) => setComponents(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runComponents();
              }
            }}
          />
          <div className="chips">
            {COMPONENT_EXAMPLES.map((m) => (
              <button
                key={m}
                className="chip"
                onClick={() => {
                  setComponents(m);
                  runComponents(m);
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="hint">
            Доступно: {keys.filter((k) => CATALOG[k]).map((k) => CATALOG[k].ru.toLowerCase()).join(', ')}. «Фоновая лампа» — монохромный вариант, «2 монеты» — копии.
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => runComponents()}>
              Собрать
            </button>
          </div>
        </>
      )}

      {picks.length > 0 && (
        <div className="picks">
          <div className="label">Почему эти объекты</div>
          <ul>
            {picks.map((p, i) => (
              <li key={i}>
                <b>
                  {CATALOG[p.key]?.ru ?? p.key}
                  {p.variant === 'bg' && <span className="badge">фон</span>}
                </b>
                <span>{p.reasons.join('; ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
