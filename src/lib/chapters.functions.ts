import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

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
    if (r.status === 429) throw new Error("Превышен лимит запросов к ИИ. Попробуйте позже.");
    if (r.status === 402) throw new Error("Закончились кредиты Lovable AI.");
    throw new Error(`Ошибка ИИ (${r.status})`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export type Chapter = { start: number; title: string; summary: string };

/** Разбор ролика по таймкодам: суть каждого смыслового блока. */
export const generateChapters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ materialId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: m } = await context.supabase
      .from("raw_materials")
      .select("id, title, raw_transcript, transcript_segments, external_id, duration_seconds")
      .eq("id", data.materialId)
      .maybeSingle();
    if (!m) throw new Error("Материал не найден");

    let segs = Array.isArray(m.transcript_segments) ? (m.transcript_segments as any[]) : [];

    // Нет сегментов — пробуем догрузить субтитры с YouTube.
    if (segs.length === 0 && m.external_id) {
      try {
        const { fetchTranscriptSegments } = await import("./transcript.server");
        const fetched = await fetchTranscriptSegments(m.external_id);
        if (fetched.length) {
          segs = fetched;
          await context.supabase
            .from("raw_materials")
            .update({
              transcript_segments: fetched as never,
              raw_transcript: m.raw_transcript || fetched.map(s => s.text).join(" "),
            })
            .eq("id", m.id);
        }
      } catch {
        /* ignore */
      }
    }

    // Всё ещё нет таймкодов — строим приблизительные из текста расшифровки.
    const plain = (m.raw_transcript ?? "").trim();
    if (segs.length === 0 && plain.length > 0) {
      const total = m.duration_seconds && m.duration_seconds > 0 ? m.duration_seconds : 0;
      const CHUNK = 800;
      const chunks: string[] = [];
      for (let i = 0; i < plain.length; i += CHUNK) chunks.push(plain.slice(i, i + CHUNK));
      segs = chunks.map((text, i) => ({
        start: total ? Math.floor((total * i) / chunks.length) : i * 60,
        dur: 0,
        text,
      }));
    }

    if (segs.length === 0) {
      throw new Error("У ролика нет расшифровки — таймкоды построить нельзя");
    }

    // Сжимаем транскрипт до строк вида [секунды] текст, чтобы модель видела время.
    const lines: string[] = [];
    let bucketStart = 0;
    let buffer: string[] = [];
    for (const s of segs) {
      if (buffer.length === 0) bucketStart = Math.floor(s.start ?? 0);
      buffer.push(String(s.text ?? ""));
      if (buffer.join(" ").length > 400) {
        lines.push(`[${bucketStart}] ${buffer.join(" ")}`);
        buffer = [];
      }
    }
    if (buffer.length) lines.push(`[${bucketStart}] ${buffer.join(" ")}`);


    const prompt = `Раздели ролик «${m.title}» на смысловые блоки по таймкодам.
Верни строго JSON: {"chapters":[{"start":СЕКУНДЫ_ЧИСЛОМ,"title":"название блока","summary":"2-3 предложения о сути блока"}]}
Правила:
- 5–12 блоков, по возрастанию времени, первый блок начинается с 0.
- start — целое число секунд из квадратных скобок исходника.
- Пиши по-русски, конкретно, без воды.

Транскрипт:
${lines.join("\n").slice(0, 24000)}`;

    const raw = await callLLM(
      "Ты — редактор экспертного видеоконтента. Отвечай ТОЛЬКО валидным JSON без markdown.",
      prompt,
    );
    let parsed: { chapters: Chapter[] };
    try {
      parsed = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, ""));
    } catch {
      throw new Error("Не удалось разобрать ответ ИИ");
    }
    const chapters = (parsed.chapters ?? [])
      .filter(c => typeof c.start === "number" && c.title)
      .sort((a, b) => a.start - b.start);
    if (chapters.length === 0) throw new Error("ИИ не вернул таймкоды");

    const { error } = await context.supabase
      .from("raw_materials")
      .update({ chapters: chapters as never })
      .eq("id", data.materialId);
    if (error) throw new Error(error.message);
    return { chapters };
  });
