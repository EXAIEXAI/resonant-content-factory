import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractYoutubeId, extractPlaylistId } from "./youtube";

type TranscriptSegment = { start: number; dur: number; text: string };

async function fetchOembed(videoId: string): Promise<{ title: string; author: string; thumbnail: string } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!r.ok) return null;
    const j: any = await r.json();
    return { title: j.title ?? "", author: j.author_name ?? "", thumbnail: j.thumbnail_url ?? "" };
  } catch {
    return null;
  }
}

function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const re = /<text[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  const decode = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/<[^>]+>/g, "")
      .trim();
  while ((m = re.exec(xml))) {
    const text = decode(m[3]);
    if (!text) continue;
    out.push({ start: parseFloat(m[1]), dur: parseFloat(m[2] ?? "0"), text });
  }
  return out;
}

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  for (const lang of ["ru", "en"]) {
    try {
      const r = await fetch(`https://video.google.com/timedtext?lang=${lang}&v=${videoId}`);
      if (!r.ok) continue;
      const xml = await r.text();
      if (!xml.trim()) continue;
      const segs = parseTimedTextXml(xml);
      if (segs.length) return segs;
    } catch {
      continue;
    }
  }
  return [];
}

/** Add a source by URL. Detects YouTube; for YouTube pulls metadata+captions (best-effort). */
export const ingestUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => z.object({ url: z.string().url().max(1000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const videoId = extractYoutubeId(data.url);

    if (!videoId) {
      // Non-YouTube — plain manual entry.
      const { data: row, error } = await supabase
        .from("raw_materials")
        .insert({
          title: data.url,
          url: data.url,
          is_manual: true,
          source_type: "manual",
          status: "found",
          engagement_score: 0,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id, source_type: "manual" as const, hasTranscript: false };
    }

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const [meta, segments] = await Promise.all([fetchOembed(videoId), fetchTranscript(videoId)]);
    const transcriptText = segments.map(s => s.text).join(" ");

    const payload = {
      external_id: videoId,
      title: meta?.title || canonicalUrl,
      channel_title: meta?.author ?? null,
      url: canonicalUrl,
      thumbnail_url: meta?.thumbnail ?? null,
      is_manual: true,
      source_type: "youtube_manual",
      status: "found",
      raw_transcript: transcriptText || null,
      transcript_segments: segments,
      engagement_score: 0,
    };

    const { data: row, error } = await supabase
      .from("raw_materials")
      .upsert(payload, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Fire-and-forget AI analysis so every source is auto-processed.
    if (transcriptText) {
      const { analyzeMaterialById } = await import("./analyze.server");
      analyzeMaterialById(supabase, row.id).catch(e => console.error("auto-analyze failed", e));
    }
    return { id: row.id, source_type: "youtube_manual" as const, hasTranscript: segments.length > 0 };
  });

export const getIntegrationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    let { data } = await supabase.from("integration_settings").select("*").eq("user_id", userId).maybeSingle();
    if (!data) {
      const ins = await supabase.from("integration_settings").insert({ user_id: userId }).select().single();
      if (ins.error) throw new Error(ins.error.message);
      data = ins.data;
    }
    return data;
  });

export const saveIntegrationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { playlist_id?: string | null; drive_folder_id?: string | null }) =>
    z
      .object({
        playlist_id: z.string().max(200).nullish(),
        drive_folder_id: z.string().max(200).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const playlist = data.playlist_id ? extractPlaylistId(data.playlist_id) ?? data.playlist_id.trim() : null;
    const { error } = await supabase
      .from("integration_settings")
      .update({ youtube_playlist_id: playlist, drive_folder_id: data.drive_folder_id?.trim() || null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase
      .from("integration_settings")
      .update({ webhook_secret: secret })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { secret };
  });
