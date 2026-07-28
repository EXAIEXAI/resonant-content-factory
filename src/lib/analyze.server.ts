import type { SupabaseClient } from "@supabase/supabase-js";

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
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Analyze a material row and persist summary + key_points. Safe to call from any server context. */
export async function analyzeMaterialById(supabase: SupabaseClient<any>, materialId: string): Promise<void> {
  const { data: m } = await supabase.from("raw_materials").select("*").eq("id", materialId).maybeSingle();
  if (!m) return;
  const source = `Заголовок: ${m.title}\nКанал: ${m.channel_title ?? ""}\n\n${m.raw_transcript ?? ""}`.trim();
  if (!source || source.length < 40) return;
  const prompt = `Проанализируй материал и верни строго JSON вида:
{"summary":"3-5 ключевых мыслей в 1 абзаце — о чём материал и что в нём содержится","key_points":[{"thesis":"тезис","timecode":"HH:MM:SS или null","quote":"короткая цитата"}]}
Материал:\n${source.slice(0, 12000)}`;
  let parsed: { summary: string; key_points: unknown[] } = { summary: "", key_points: [] };
  try {
    const raw = await callLLM(
      "Ты — аналитик экспертного контента. Отвечай ТОЛЬКО валидным JSON без markdown.",
      prompt,
    );
    parsed = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, ""));
  } catch (e) {
    console.error("analyzeMaterialById failed", materialId, e);
    return;
  }
  await supabase
    .from("raw_materials")
    .update({ summary: parsed.summary, key_points: parsed.key_points as never, status: "analyzed" })
    .eq("id", materialId);
}
