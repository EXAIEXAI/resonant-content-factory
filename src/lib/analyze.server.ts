import type { SupabaseClient } from "@supabase/supabase-js";
import { callLLMRaw } from "@/lib/llm.server";

async function callLLM(system: string, user: string): Promise<string> {
  return callLLMRaw(system, user, { json: true });
}

function parseJsonLoose(raw: string): any {
  const cleaned = raw.replace(/```json/gi, "```").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error("Модель вернула неразборчивый ответ");
  }
}

function youtubeId(m: any): string | null {
  const direct = String(m.external_id ?? "").trim();
  if (/^[\w-]{11}$/.test(direct)) return direct;
  const url = String(m.url ?? "");
  const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

/** Analyze a material row and persist summary + key_points. Safe to call from any server context. */
export async function analyzeMaterialById(
  supabase: SupabaseClient<any>,
  materialId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: m } = await supabase.from("raw_materials").select("*").eq("id", materialId).maybeSingle();
  if (!m) return { ok: false, error: "Ролик не найден" };

  let transcript = String(m.raw_transcript ?? "").trim();
  // Если расшифровки нет — пробуем забрать субтитры YouTube и сохранить их.
  if (transcript.length < 40) {
    const vid = youtubeId(m);
    if (vid) {
      try {
        const { fetchTranscriptSegments } = await import("@/lib/transcript.server");
        const segs = await fetchTranscriptSegments(vid);
        if (segs.length) {
          transcript = segs.map(s => s.text).join(" ").trim();
          if (transcript.length >= 40) {
            await supabase.from("raw_materials").update({ raw_transcript: transcript }).eq("id", materialId);
          }
        }
      } catch (e) {
        console.error("transcript fetch failed", materialId, e);
      }
    }
  }

  const hasTranscript = transcript.length >= 40;
  const source = hasTranscript
    ? `Заголовок: ${m.title}\nКанал: ${m.channel_title ?? ""}\n\nТранскрипт:\n${transcript}`
    : `Заголовок: ${m.title}\nКанал: ${m.channel_title ?? ""}\nURL: ${m.url ?? ""}`;
  const detail = `Требования к key_points: 5–7 пунктов. Поле "thesis" — это НЕ одно предложение, а развёрнутый подробный абзац из 4–7 предложений (минимум 300 символов): сформулируй мысль автора, подробно раскрой её — что именно автор имеет в виду, на каких аргументах, фактах и примерах это строит, к какому выводу приходит. Читатель, который не смотрел ролик, должен по одному абзацу полностью понять эту мысль. Опирайся на конкретику из транскрипта: имена, цифры, кейсы, формулировки автора. Без воды и повторов.
Поле "summary" — один связный абзац из 4–6 предложений о том, чему посвящён материал и что зритель из него вынесет.
Пиши утвердительно, от лица содержания ролика. Категорически запрещены слова и обороты неуверенности: «вероятно», «скорее всего», «предположительно», «по всей видимости», «возможно», «судя по всему», «наверное». Никаких оговорок о том, что расшифровки нет.`;
  const prompt = hasTranscript
    ? `Проанализируй материал и верни строго JSON вида:
{"summary":"абзац","key_points":[{"thesis":"развёрнутый абзац","timecode":"HH:MM:SS или null","quote":"короткая цитата"}]}
${detail}
Материал:\n${source.slice(0, 12000)}`
    : `По заголовку и каналу сформулируй, о чём этот ролик, какая от него польза зрителю и какие мысли раскрывает автор. Пиши утвердительно и по делу, без оговорок и без слов неуверенности. Верни строго JSON:
{"summary":"абзац","key_points":[{"thesis":"развёрнутый тезис абзацем","timecode":null,"quote":""}]}
${detail}
Материал:\n${source}`;

  let parsed: { summary?: string; key_points?: unknown[] };
  try {
    const raw = await callLLM(
      "Ты — аналитик экспертного контента. Отвечай ТОЛЬКО валидным JSON без markdown. Формулируй утвердительно: не используй слова «вероятно», «скорее всего», «возможно», «предположительно», «по всей видимости».",
      prompt,
    );
    parsed = parseJsonLoose(raw);
  } catch (e) {
    console.error("analyzeMaterialById failed", materialId, e);
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось разобрать ролик" };
  }

  const summary = String(parsed.summary ?? "").trim();
  if (!summary) return { ok: false, error: "Модель не вернула описание" };
  const { data: saved, error: upErr } = await supabase
    .from("raw_materials")
    .update({
      summary,
      key_points: (Array.isArray(parsed.key_points) ? parsed.key_points : []) as never,
    })
    .eq("id", materialId)
    .select("id");
  if (upErr || !saved?.length) {
    console.error("analyze save failed", materialId, upErr, saved);
    return { ok: false, error: upErr?.message ?? "Не удалось сохранить описание" };
  }
  return { ok: true };
}
