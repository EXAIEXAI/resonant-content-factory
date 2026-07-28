import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Build a weekly digest: top 20% (min 3) of materials from the past 7 days. */
export async function buildWeeklyDigestFor(
  supabase: SupabaseClient<any>,
  createdBy: string | null,
): Promise<{ id: string | null; count: number; created: boolean }> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: mats, error } = await supabase
    .from("raw_materials")
    .select("id, engagement_score, created_at")
    .gte("created_at", since)
    .order("engagement_score", { ascending: false });
  if (error) throw new Error(error.message);
  const list = mats ?? [];
  if (list.length === 0) return { id: null, count: 0, created: false };

  const cutoff = Math.max(3, Math.ceil(list.length * 0.2));
  const picked = list.slice(0, cutoff);
  const material_ids = picked.map(p => p.id);

  const now = new Date();
  const weekLabel = `Неделя ${now.toLocaleDateString("ru", { day: "2-digit", month: "short" })}`;

  const { data: row, error: insErr } = await supabase
    .from("digests")
    .insert({
      title: `Дайджест · ${weekLabel}`,
      status: "draft",
      material_ids,
      content_json: { window_days: 7, picked: picked.length, pool: list.length, auto: true },
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);

  await supabase.from("raw_materials").update({ status: "in_digest" }).in("id", material_ids);
  return { id: row.id, count: material_ids.length, created: true };
}

export const buildWeeklyDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => buildWeeklyDigestFor(context.supabase, context.userId));
