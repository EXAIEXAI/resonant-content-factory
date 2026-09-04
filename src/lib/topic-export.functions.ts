import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ExportedMaterial = {
  id: string;
  title: string;
  channel: string | null;
  url: string | null;
  youtube_url: string | null;
  source_type: string | null;
  summary: string | null;
};

export type ExportedOutput = {
  id: string;
  format: string;
  status: string;
  version: number;
  created_at: string;
  text: string;
};

export type ExportedTopic = {
  id: string;
  title: string;
  chosen_angle: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  angles: string[];
  materials: ExportedMaterial[];
  youtube_links: string[];
  essays: ExportedOutput[];
  scripts: ExportedOutput[];
  other_outputs: ExportedOutput[];
  prompts: { id: string; name: string; purpose: string; body: string }[];
  comments: {
    material_title: string;
    reaction_type: string | null;
    timecode: string | null;
    linked_thesis: string | null;
    text: string | null;
    created_at: string;
  }[];
};

/** Собирает полные данные тем для пакетной выгрузки (PDF + JSON + Markdown). */
export const exportTopicsBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topicIds: z.array(z.string().uuid()).nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ topics: ExportedTopic[] }> => {
    let topicsQuery = context.supabase.from("topics").select("*").order("created_at", { ascending: false });
    if (data.topicIds && data.topicIds.length) topicsQuery = topicsQuery.in("id", data.topicIds);
    const { data: topics, error } = await topicsQuery;
    if (error) throw new Error(error.message);
    const list = topics ?? [];
    if (!list.length) return { topics: [] };

    const topicIds = list.map(t => t.id);
    const materialIds = Array.from(
      new Set(list.flatMap(t => (t.selected_material_ids ?? []) as string[])),
    );

    const [{ data: outputs }, { data: materials }, { data: prompts }, { data: positions }] = await Promise.all([
      context.supabase
        .from("content_outputs")
        .select("id, topic_id, format, status, version, created_at, generated_text, edited_text")
        .in("topic_id", topicIds)
        .order("created_at", { ascending: true }),
      materialIds.length
        ? context.supabase
            .from("raw_materials")
            .select("id, title, channel_title, url, external_id, source_type, summary")
            .in("id", materialIds)
        : Promise.resolve({ data: [] as any[] }),
      context.supabase
        .from("style_templates")
        .select("id, name, purpose, prompt_body")
        .eq("kind", "prompt")
        .order("created_at", { ascending: false }),
      materialIds.length
        ? context.supabase
            .from("expert_positions")
            .select("material_id, reaction_type, timecode, linked_thesis, transcript, created_at")
            .in("material_id", materialIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const materialById = new Map<string, any>((materials ?? []).map(m => [m.id, m]));
    const promptRows = (prompts ?? []).map(p => ({
      id: p.id,
      name: p.name,
      purpose: p.purpose ?? "general",
      body: p.prompt_body ?? "",
    }));

    const ytUrl = (m: any): string | null => {
      if (m.source_type && String(m.source_type).startsWith("telegram")) return null;
      if (m.url && /youtu/.test(m.url)) return m.url;
      if (m.external_id) return `https://www.youtube.com/watch?v=${m.external_id}`;
      return m.url ?? null;
    };

    return {
      topics: list.map(t => {
        const ids: string[] = t.selected_material_ids ?? [];
        const mats: ExportedMaterial[] = ids
          .map(id => materialById.get(id))
          .filter(Boolean)
          .map(m => ({
            id: m.id,
            title: m.title,
            channel: m.channel_title ?? null,
            url: m.url ?? null,
            youtube_url: ytUrl(m),
            source_type: m.source_type ?? null,
            summary: m.summary ?? null,
          }));

        const outs = (outputs ?? [])
          .filter(o => o.topic_id === t.id)
          .map<ExportedOutput>(o => ({
            id: o.id,
            format: o.format,
            status: o.status,
            version: o.version ?? 1,
            created_at: o.created_at,
            text: o.edited_text ?? o.generated_text ?? "",
          }));

        const comments = (positions ?? [])
          .filter(p => ids.includes(p.material_id))
          .map(p => ({
            material_title: materialById.get(p.material_id)?.title ?? "—",
            reaction_type: p.reaction_type ?? null,
            timecode: p.timecode ?? null,
            linked_thesis: p.linked_thesis ?? null,
            text: p.transcript ?? null,
            created_at: p.created_at,
          }));

        return {
          id: t.id,
          title: t.title,
          chosen_angle: t.chosen_angle ?? null,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at ?? null,
          angles: Array.isArray(t.angles) ? (t.angles as unknown[]).map(String) : [],
          materials: mats,
          youtube_links: mats.map(m => m.youtube_url).filter((u): u is string => !!u),
          essays: outs.filter(o => o.format === "essay"),
          scripts: outs.filter(o => o.format === "script"),
          other_outputs: outs.filter(o => o.format !== "essay" && o.format !== "script"),
          prompts: promptRows,
          comments,
        };
      }),
    };
  });
