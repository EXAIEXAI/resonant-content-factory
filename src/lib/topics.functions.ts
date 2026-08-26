import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { callLLM, parseJsonLoose } from "@/lib/llm.server";

export const createTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ title: z.string().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("topics")
      .insert({ title: data.title.trim(), created_by: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const suggestMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ topicId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: topic } = await context.supabase.from("topics").select("*").eq("id", data.topicId).maybeSingle();
    if (!topic) throw new Error("Тема не найдена");
    const { data: materials } = await context.supabase
      .from("raw_materials")
      .select("id, title, summary, category, channel_title, thumbnail_url, views")
      .order("created_at", { ascending: false })
      .limit(200);
    const list = materials ?? [];
    if (list.length === 0) return { suggestions: [] as any[] };

    const catalog = list
      .map((m, i) => `#${i + 1} [${m.id}] «${m.title}» — ${(m.summary ?? "").slice(0, 200)}`)
      .join("\n");
    const raw = await callLLM(
      "Ты — редактор контент-завода. Отвечай ТОЛЬКО валидным JSON без markdown.",
      `Тема: «${topic.title}».
Из каталога роликов ниже выбери до 10 наиболее подходящих по смыслу. Верни строго JSON: {"ids":["uuid",...]}
Каталог:\n${catalog.slice(0, 12000)}`,
    );
    const parsed = parseJsonLoose<{ ids: string[] }>(raw, { ids: [] });
    const byId = new Map(list.map(m => [m.id, m]));
    const suggestions = (parsed.ids ?? []).map(id => byId.get(id)).filter(Boolean);
    return { suggestions };
  });

export const saveTopicMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topicId: z.string().uuid(), materialIds: z.array(z.string().uuid()).min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("topics")
      .update({ selected_material_ids: data.materialIds, status: "materials_selected", updated_at: new Date().toISOString() })
      .eq("id", data.topicId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateAngles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ topicId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: topic } = await context.supabase.from("topics").select("*").eq("id", data.topicId).maybeSingle();
    if (!topic) throw new Error("Тема не найдена");
    const ids: string[] = topic.selected_material_ids ?? [];
    const { data: materials } = ids.length
      ? await context.supabase.from("raw_materials").select("title, summary, key_points").in("id", ids)
      : { data: [] as any[] };
    const contextBlock = (materials ?? [])
      .map(m => `«${m.title}»: ${(m.summary ?? "").slice(0, 300)}`)
      .join("\n");
    const raw = await callLLM(
      "Ты — редактор контент-завода. Отвечай ТОЛЬКО валидным JSON без markdown.",
      `Общая тема: «${topic.title}».
Отобранные ролики:\n${contextBlock.slice(0, 8000)}

Предложи ровно 10 конкретных уточняющих тем (заголовков будущего ролика/эссе), опирающихся на эти материалы. Каждая — одна строка, цепляющая и конкретная.
Верни строго JSON: {"angles":["тема 1",...,"тема 10"]}`,
    );
    const parsed = parseJsonLoose<{ angles: string[] }>(raw, { angles: [] });
    const angles = (parsed.angles ?? []).filter(a => typeof a === "string" && a.trim()).slice(0, 10);
    if (angles.length === 0) throw new Error("ИИ не вернул список тем, попробуйте ещё раз");
    const { error } = await context.supabase
      .from("topics")
      .update({ angles, status: "angles_ready", updated_at: new Date().toISOString() })
      .eq("id", data.topicId);
    if (error) throw new Error(error.message);
    return { angles };
  });

export const chooseAngle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topicId: z.string().uuid(), angle: z.string().min(3).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("topics")
      .update({ chosen_angle: data.angle.trim(), status: "angle_chosen", updated_at: new Date().toISOString() })
      .eq("id", data.topicId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateTopicEssay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topicId: z.string().uuid(), promptId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: topic } = await context.supabase.from("topics").select("*").eq("id", data.topicId).maybeSingle();
    if (!topic) throw new Error("Тема не найдена");
    const ids: string[] = topic.selected_material_ids ?? [];
    const [{ data: materials }, { data: positions }, { data: promptRow }] = await Promise.all([
      ids.length
        ? context.supabase.from("raw_materials").select("id, title, summary, key_points").in("id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? context.supabase.from("expert_positions").select("material_id, reaction_type, transcript, linked_thesis").in("material_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      data.promptId
        ? context.supabase.from("style_templates").select("name, prompt_body").eq("id", data.promptId).maybeSingle()
        : Promise.resolve({ data: null as any }),
    ]);

    const materialsBlock = (materials ?? []).map(m => {
      const pos = (positions ?? []).filter(p => p.material_id === m.id)
        .map(p => `  [${p.reaction_type}] ${p.linked_thesis ? "к тезису: " + p.linked_thesis + " — " : ""}${p.transcript ?? ""}`)
        .join("\n");
      return `Ролик «${m.title}»:\nВыжимка: ${m.summary ?? "нет"}\nТезисы: ${JSON.stringify(m.key_points ?? []).slice(0, 1200)}\nКомментарии экспертов:\n${pos || "(нет)"}`;
    }).join("\n\n");

    const system = `Ты — редактор экспертного контента компании. Пиши в фирменной тональности.
${promptRow?.prompt_body ? `Инструкция «${promptRow.name}» (строго следуй):\n${promptRow.prompt_body}\n` : ""}
Разделяй факты источников и позицию экспертов. Позиция экспертов — основа, факты — контекст.`;

    const user = `Тема эссе: «${topic.chosen_angle ?? topic.title}».
Напиши сильное бизнес-эссе на 1–2 страницы по указанной инструкции, опираясь на контекст роликов и комментарии экспертов ниже.

${materialsBlock.slice(0, 14000)}

Верни готовый текст эссе без вводных фраз.`;

    const text = await callLLM(system, user);
    const { data: out, error } = await context.supabase
      .from("content_outputs")
      .insert({
        topic_id: data.topicId,
        format: "essay",
        generated_text: text,
        status: "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("topics").update({ status: "essay_draft", updated_at: new Date().toISOString() }).eq("id", data.topicId);
    return out;
  });

export const generateTopicScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topicId: z.string().uuid(), promptId: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: topic } = await context.supabase.from("topics").select("*").eq("id", data.topicId).maybeSingle();
    if (!topic) throw new Error("Тема не найдена");
    const { data: essay } = await context.supabase
      .from("content_outputs")
      .select("*")
      .eq("topic_id", data.topicId)
      .eq("format", "essay")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!essay) throw new Error("Сначала подтвердите эссе");
    const { data: promptRow } = data.promptId
      ? await context.supabase.from("style_templates").select("name, prompt_body").eq("id", data.promptId).maybeSingle()
      : { data: null as any };

    const system = `Ты — сценарист видеоконтента компании.
${promptRow?.prompt_body ? `Инструкция «${promptRow.name}» (строго следуй):\n${promptRow.prompt_body}\n` : ""}`;

    const user = `На основании подтверждённого эссе ниже напиши сценарий ролика: раскадровка по сценам, текст диктора, on-screen текст.

Эссе:
${(essay.edited_text ?? essay.generated_text ?? "").slice(0, 12000)}

Верни готовый сценарий без вводных фраз.`;

    const text = await callLLM(system, user);
    const { data: out, error } = await context.supabase
      .from("content_outputs")
      .insert({
        topic_id: data.topicId,
        format: "script",
        generated_text: text,
        status: "draft",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("topics").update({ status: "script_draft", updated_at: new Date().toISOString() }).eq("id", data.topicId);
    return out;
  });
