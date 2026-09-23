import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { callLLM } from "@/lib/llm.server";
import { analyzeMaterialById } from "@/lib/analyze.server";

const IdInput = z.object({ materialId: z.string().uuid(), force: z.boolean().optional() });

/** Гарантирует, что у ролика есть краткое описание и основные мысли. */
export const ensureMaterialSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: m } = await context.supabase
      .from("raw_materials")
      .select("id, summary, key_points")
      .eq("id", data.materialId)
      .maybeSingle();
    if (!m) throw new Error("Ролик не найден");
    const hasSummary = (m.summary ?? "").trim().length > 10;
    const hasPoints = Array.isArray(m.key_points) && m.key_points.length > 0;
    let error: string | undefined;
    if (data.force || !hasSummary || !hasPoints) {
      const res = await analyzeMaterialById(context.supabase as never, data.materialId);
      if (!res.ok) error = res.error;
    }
    const { data: fresh } = await context.supabase
      .from("raw_materials")
      .select("summary, key_points")
      .eq("id", data.materialId)
      .maybeSingle();
    return { summary: fresh?.summary ?? "", key_points: fresh?.key_points ?? [], error: error ?? null };
  });

async function loadPrompt(supabase: any, purpose: "essay" | "script", promptId?: string | null) {
  if (promptId) {
    const { data } = await supabase
      .from("style_templates")
      .select("name, prompt_body")
      .eq("id", promptId)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from("style_templates")
    .select("name, prompt_body")
    .eq("kind", "prompt")
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function materialContext(supabase: any, materialId: string) {
  const { data: m } = await supabase
    .from("raw_materials")
    .select("id, title, channel_title, url, summary, key_points, raw_transcript")
    .eq("id", materialId)
    .maybeSingle();
  if (!m) throw new Error("Ролик не найден");
  const { data: positions } = await supabase
    .from("expert_positions")
    .select("reaction_type, transcript, linked_thesis, timecode")
    .eq("material_id", materialId)
    .order("created_at", { ascending: true });
  const comments = (positions ?? [])
    .map(
      (p: any) =>
        `  [${p.reaction_type ?? "комментарий"}]${p.timecode ? ` (${p.timecode})` : ""}${
          p.linked_thesis ? ` к тезису «${p.linked_thesis}»` : ""
        }: ${p.transcript ?? ""}`,
    )
    .join("\n");
  const block = `Ролик «${m.title}» (${m.channel_title ?? "канал не указан"}), ссылка: ${m.url ?? "—"}
Краткое описание: ${m.summary ?? "нет"}
Основные мысли: ${JSON.stringify(m.key_points ?? []).slice(0, 3000)}
Фрагмент расшифровки: ${(m.raw_transcript ?? "").slice(0, 8000)}`;
  return { material: m, block, comments };
}

const GenInput = z.object({
  materialId: z.string().uuid(),
  comment: z.string().max(8000).optional().nullable(),
  promptId: z.string().uuid().optional().nullable(),
});

export const generateMaterialEssay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { material, block, comments } = await materialContext(context.supabase, data.materialId);
    const prompt = await loadPrompt(context.supabase, "essay", data.promptId);
    const userComment = (data.comment ?? "").trim();

    const system = `Ты — редактор экспертного контента компании. Пиши по-русски, в фирменной тональности.
${prompt?.prompt_body ? `Инструкция «${prompt.name}» (строго следуй):\n${prompt.prompt_body}\n` : ""}
Факты ролика — контекст, позиция эксперта — основа.`;
    const user = `Материал:
${block}

${comments ? `Ранее оставленные комментарии экспертов:\n${comments.slice(0, 4000)}\n` : ""}${
      userComment ? `Комментарий продюсера (обязательно учти):\n${userComment}\n` : ""
    }
Напиши готовое эссе по этому ролику. Без вводных фраз и пояснений.`;

    const text = await callLLM(system, user);
    if (userComment) {
      await context.supabase.from("expert_positions").insert({
        material_id: data.materialId,
        reaction_type: "комментарий",
        transcript: userComment,
        expert_id: context.userId,
      });
    }
    const { data: out, error } = await context.supabase
      .from("content_outputs")
      .insert({
        material_id: data.materialId,
        format: "essay",
        generated_text: text,
        status: "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ...out, materialTitle: material.title };
  });

export const generateMaterialScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.extend({ essayId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: essay } = await context.supabase
      .from("content_outputs")
      .select("generated_text, edited_text")
      .eq("id", data.essayId)
      .maybeSingle();
    if (!essay) throw new Error("Эссе не найдено");
    const { material, comments } = await materialContext(context.supabase, data.materialId);
    const prompt = await loadPrompt(context.supabase, "script", data.promptId);
    const userComment = (data.comment ?? "").trim();

    const system = `Ты — сценарист видеоконтента компании. Пиши по-русски.
${prompt?.prompt_body ? `Инструкция «${prompt.name}» (строго следуй):\n${prompt.prompt_body}\n` : ""}`;
    const user = `Исходный ролик: «${material.title}».

Эссе:
${(essay.edited_text ?? essay.generated_text ?? "").slice(0, 12000)}

${comments ? `Комментарии экспертов:\n${comments.slice(0, 4000)}\n` : ""}${
      userComment ? `Комментарий продюсера к сценарию (обязательно учти):\n${userComment}\n` : ""
    }
Напиши готовый сценарий ролика: сцены, текст диктора, on-screen текст. Без вводных фраз.`;

    const text = await callLLM(system, user);
    if (userComment) {
      await context.supabase.from("expert_positions").insert({
        material_id: data.materialId,
        reaction_type: "комментарий",
        transcript: userComment,
        expert_id: context.userId,
      });
    }
    const { data: out, error } = await context.supabase
      .from("content_outputs")
      .insert({
        material_id: data.materialId,
        format: "script",
        generated_text: text,
        status: "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return out;
  });
