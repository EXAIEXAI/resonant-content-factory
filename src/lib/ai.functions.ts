import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

async function callLLM(system: string, user: string) {
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
  return data.choices?.[0]?.message?.content ?? "";
}

export const analyzeMaterial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ materialId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: m, error } = await context.supabase
      .from("raw_materials")
      .select("*")
      .eq("id", data.materialId)
      .maybeSingle();
    if (error || !m) throw new Error("Материал не найден");
    const source = (m.raw_transcript ?? "") + "\n\nЗаголовок: " + m.title;
    const prompt = `Проанализируй экспертный материал и верни строго JSON вида:
{"summary":"3-5 ключевых мыслей в 1 абзаце","key_points":[{"thesis":"тезис","timecode":"HH:MM:SS или null","quote":"цитата"}]}
Материал:\n${source.slice(0, 8000)}`;
    const raw = await callLLM(
      "Ты — аналитик экспертного контента. Отвечай ТОЛЬКО валидным JSON без markdown.",
      prompt,
    );
    let parsed: { summary: string; key_points: Array<{ thesis: string; timecode: string | null; quote: string }> };
    try {
      parsed = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, ""));
    } catch {
      parsed = { summary: raw.slice(0, 500), key_points: [] };
    }
    await context.supabase
      .from("raw_materials")
      .update({ summary: parsed.summary, key_points: parsed.key_points as never })
      .eq("id", data.materialId);
    return parsed;
  });

export const generateContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      materialId: z.string().uuid(),
      format: z.enum(["article", "telegram_post", "shorts_script", "email", "speech_theses"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const [{ data: m }, { data: positions }, { data: styles }] = await Promise.all([
      context.supabase.from("raw_materials").select("*").eq("id", data.materialId).maybeSingle(),
      context.supabase.from("expert_positions").select("*").eq("material_id", data.materialId),
      context.supabase.from("style_templates").select("*"),
    ]);
    if (!m) throw new Error("Материал не найден");

    const postulates = (styles ?? []).filter(s => s.kind === "postulate").map(s => "— " + s.prompt_body).join("\n");
    const aphorisms = (styles ?? []).filter(s => s.kind === "aphorism").map(s => "— " + s.prompt_body).join("\n");
    const samples = (styles ?? []).filter(s => s.kind === "golden_sample").map(s => s.prompt_body).join("\n---\n");
    const expertBlock = (positions ?? []).map(p =>
      `[${p.reaction_type}] ${p.linked_thesis ? "к тезису: " + p.linked_thesis + " — " : ""}${p.transcript ?? ""}`
    ).join("\n");

    const formatBrief: Record<string, string> = {
      article: "Экспертная статья 800–1200 слов: сильный хук, подводка, 3–5 смысловых блоков с примерами, кульминация, вывод, призыв к действию.",
      telegram_post: "Пост для Telegram 800–1500 знаков: цепляющий хук в первой строке, короткие абзацы, эмодзи умеренно, вывод одним предложением.",
      shorts_script: "Сценарий Shorts/Reels 45–60 сек: раскадровка по сценам (Сцена 1: ...), текст диктора, on-screen текст.",
      email: "Email-рассылка: тема письма, прехедер, тело 300–500 слов, CTA.",
      speech_theses: "Тезисы для публичного выступления: 5–7 ключевых тезисов с примерами и переходами.",
    };

    const system = `Ты — редактор экспертного контента компании. Пиши в фирменной тональности.
${postulates ? "Постулаты компании:\n" + postulates + "\n" : ""}
${aphorisms ? "Афоризмы (используй уместно):\n" + aphorisms + "\n" : ""}
${samples ? "Образцы стиля:\n" + samples.slice(0, 2000) + "\n" : ""}
Разделяй факты источника и позицию эксперта. Позиция эксперта — основа, факты источника — контекст.`;

    const user = `Задача: ${formatBrief[data.format]}

Источник (${m.title}):
Выжимка: ${m.summary ?? "нет"}
Ключевые тезисы: ${JSON.stringify(m.key_points ?? []).slice(0, 2000)}

Позиция эксперта:
${expertBlock || "(нет комментариев эксперта — используй только источник)"}

Верни готовый текст без вводных фраз.`;

    const text = await callLLM(system, user);
    const { data: out, error } = await context.supabase
      .from("content_outputs")
      .insert({
        material_id: data.materialId,
        format: data.format,
        generated_text: text,
        status: "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });

export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ text: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    return { transcript: data.text };
  });

export const processKnowledgeFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      filename: z.string().min(1).max(200),
      text: z.string().min(10).max(200000),
      kind: z.enum(["postulate", "aphorism", "golden_sample", "template"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const prompt = `Из содержимого файла «${data.filename}» извлеки записи для базы знаний типа «${data.kind}».
Верни строго JSON: {"entries":[{"name":"краткое имя (до 80 симв.)","body":"полный текст записи"}]}
Правила:
- Для postulate/aphorism — раздели на отдельные короткие записи (1 запись = 1 постулат/афоризм).
- Для golden_sample/template — сохрани цельный текст как одну запись, name = осмысленный заголовок.
- Убери мусор (шапки, номера страниц, служебные пометки).

Содержимое:
${data.text.slice(0, 60000)}`;
    const raw = await callLLM(
      "Ты — редактор базы знаний. Отвечай ТОЛЬКО валидным JSON без markdown.",
      prompt,
    );
    let parsed: { entries: Array<{ name: string; body: string }> };
    try {
      parsed = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, ""));
    } catch {
      parsed = { entries: [{ name: data.filename, body: data.text.slice(0, 4000) }] };
    }
    const rows = (parsed.entries ?? [])
      .filter(e => e.body?.trim())
      .map(e => ({ name: (e.name || data.filename).slice(0, 200), kind: data.kind, prompt_body: e.body }));
    if (rows.length === 0) throw new Error("Не удалось извлечь записи из файла");
    const { error } = await context.supabase.from("style_templates").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });
