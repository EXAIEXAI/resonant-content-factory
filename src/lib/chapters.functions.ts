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
      .select("id, title, raw_transcript, transcript_segments")
      .eq("id", data.materialId)
      .maybeSingle();
    if (!m) throw new Error("Материал не найден");

    const segs = Array.isArray(m.transcript_segments) ? (m.transcript_segments as any[]) : [];
    if (segs.length === 0) {
      throw new Error("Нет транскрипта с таймкодами — таймкоды построить нельзя");
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
