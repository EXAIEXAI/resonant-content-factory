import type { SupabaseClient } from "@supabase/supabase-js";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

async function callLLM(system: string, user: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Ключ ИИ недоступен");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
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
  const prompt = hasTranscript
    ? `Проанализируй материал и верни строго JSON вида:
{"summary":"3-5 ключевых мыслей в 1 абзаце — о чём материал и что в нём содержится","key_points":[{"thesis":"тезис","timecode":"HH:MM:SS или null","quote":"короткая цитата"}]}
Материал:\n${source.slice(0, 12000)}`
    : `Расшифровки нет. По заголовку и каналу сформулируй, о чём этот ролик, какая от него польза зрителю и какие мысли автор, скорее всего, раскрывает. Верни строго JSON:
{"summary":"2-4 предложения","key_points":[{"thesis":"предполагаемый тезис","timecode":null,"quote":""}]}
Материал:\n${source}`;

  let parsed: { summary?: string; key_points?: unknown[] };
  try {
    const raw = await callLLM(
      "Ты — аналитик экспертного контента. Отвечай ТОЛЬКО валидным JSON без markdown.",
      prompt,
    );
    parsed = parseJsonLoose(raw);
  } catch (e) {
    console.error("analyzeMaterialById failed", materialId, e);
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось разобрать ролик" };
  }

  const summary = String(parsed.summary ?? "").trim();
  if (!summary) return { ok: false, error: "Модель не вернула описание" };
  await supabase
    .from("raw_materials")
    .update({
      summary,
      key_points: (Array.isArray(parsed.key_points) ? parsed.key_points : []) as never,
      status: "analyzed",
    })
    .eq("id", materialId);
  return { ok: true };
}
