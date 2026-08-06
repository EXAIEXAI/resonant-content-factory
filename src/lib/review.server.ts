// Server-only: формирование развёрнутого разбора видео («Читать обзор»).
import type { SupabaseClient } from "@supabase/supabase-js";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

type AnyClient = SupabaseClient<any, any, any>;

async function callLLM(system: string, user: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY отсутствует");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    if (r.status === 429) throw new Error("Превышен лимит запросов к ИИ. Попробуйте позже.");
    if (r.status === 402) throw new Error("Закончились кредиты Lovable AI. Пополните в настройках.");
    throw new Error(`Ошибка ИИ (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

const SYSTEM = `Ты — аналитик экспертного контента. Готовишь письменные разборы видео на русском языке.
Пиши содержательно, без воды и без вводных фраз вроде «Конечно» или «Вот разбор».
Отвечай в Markdown, строго по заданной структуре, без блоков кода.`;

function buildPrompt(m: {
  title: string;
  channel_title?: string | null;
  url?: string | null;
  duration_seconds?: number | null;
  raw_transcript?: string | null;
  transcript_segments?: unknown;
}): string {
  const hasTranscript = (m.raw_transcript ?? "").trim().length >= 200;
  const segments = Array.isArray(m.transcript_segments)
    ? (m.transcript_segments as Array<{ start?: number; text?: string }>)
        .map((s) => `[${fmtTc(s.start ?? 0)}] ${s.text ?? ""}`)
        .join("\n")
    : "";
  const body = segments || m.raw_transcript || "";

  const structure = `Структура ответа (Markdown):

# Разбор видео: ${m.title}

## О чем видео и кто участвует
Короткое описание сути видео (1–2 абзаца).

## Спикеры и участники
Маркированный список: имя — кто это и в чём его компетентность по обсуждаемому вопросу. Если спикеры не определяются, напиши об этом одной строкой.

## Логический разбор видео по блокам
Раздели видео на логичные смысловые блоки длительностью от 5 до 15 минут. Для каждого блока:

### Блок N: <название блока> [ЧЧ:ММ:СС] — [ЧЧ:ММ:СС]
**Основные мысли:**
1. …
2. …
3. …

**Яркая цитата:**
«…»

## Итоговый вывод по всему видео
1–2 абзаца.

## Экспертное мнение по теме
3 пронумерованных пункта, каждый с жирным заголовком-тезисом и пояснением на 2–4 предложения. Это твоя собственная экспертная позиция, а не пересказ видео.`;

  const meta = `Название: ${m.title}
Канал: ${m.channel_title ?? "неизвестен"}
Ссылка: ${m.url ?? ""}
Длительность: ${m.duration_seconds ? fmtTc(m.duration_seconds) : "неизвестна"}`;

  if (!hasTranscript && !segments) {
    return `${structure}

ВАЖНО: транскрипта нет. Опирайся на название и канал, разбор строй как обоснованную реконструкцию содержания. Блоки давай без выдуманных точных таймкодов — пиши диапазоны как «примерно 00:00:00 — 00:10:00», цитаты не выдумывай: вместо цитаты приводи ключевую формулировку темы.

${meta}`;
  }

  return `${structure}

Таймкоды бери из транскрипта. Цитаты — дословные из транскрипта.

${meta}

Транскрипт:
${body.slice(0, 60000)}`;
}

function fmtTc(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Формирует разбор материала и сохраняет его в raw_materials.review_md. */
export async function generateReviewById(
  supabase: AnyClient,
  materialId: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  const { data: m } = await supabase
    .from("raw_materials")
    .select("id, title, channel_title, url, duration_seconds, raw_transcript, transcript_segments, review_md")
    .eq("id", materialId)
    .maybeSingle();
  if (!m) return null;
  if (m.review_md && !opts?.force) return m.review_md as string;

  const text = await callLLM(SYSTEM, buildPrompt(m as never));
  const clean = text.replace(/^```(?:markdown)?\n?|\n?```$/g, "").trim();
  if (!clean) return null;

  await supabase
    .from("raw_materials")
    .update({ review_md: clean, review_generated_at: new Date().toISOString() })
    .eq("id", materialId);
  return clean;
}
