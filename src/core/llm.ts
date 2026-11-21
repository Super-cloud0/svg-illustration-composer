import type { LibraryObject } from './types';
import type { Pick } from './matching';

export const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Optional AI step for Scenario 1. The model only *chooses* object IDs from
 * library.json and explains why — it never produces graphics. Any ID that is
 * not in the provided list is discarded.
 */
export async function suggestWithGroq(phrase: string, apiKey: string, candidates: LibraryObject[], signal?: AbortSignal): Promise<Pick[]> {
  const list = candidates.map((o) => `${o.id}: ${o.name} / ${o.nameEn} (${o.tags.slice(0, 8).join(', ')})`).join('\n');
  const system =
    'Ты арт-директор. По метафоре или заголовку выбери от 2 до 5 предметов из списка, которые лучше всего передают смысл. ' +
    'Используй ТОЛЬКО id из списка. Ничего не рисуй и не придумывай новых предметов. ' +
    'Ответ строго JSON: {"objects":[{"id":"<id из списка>","reason":"<коротко по-русски, почему>"}]}';
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Список предметов:\n${list}\n\nМетафора: «${phrase}»` },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(res.status === 401 ? 'Groq: неверный API-ключ' : `Groq: ошибка ${res.status} ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  return parseLlmAnswer(data?.choices?.[0]?.message?.content ?? '', candidates);
}

/** Validate the model answer against the library: unknown ids are dropped. */
export function parseLlmAnswer(content: string, candidates: LibraryObject[]): Pick[] {
  let parsed: { objects?: { id?: string; reason?: string }[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Groq вернул не-JSON ответ');
  }
  const picks: Pick[] = [];
  for (const o of parsed.objects ?? []) {
    const entry = candidates.find((c) => c.id === o.id);
    if (!entry || picks.some((p) => p.key === entry.key)) continue;
    picks.push({ key: entry.key, variant: 'main', score: 0, reasons: [`AI: ${o.reason || 'подходит по смыслу'}`] });
  }
  if (picks.length === 0) throw new Error('Groq не выбрал ни одного объекта из библиотеки');
  return picks.slice(0, 5);
}
