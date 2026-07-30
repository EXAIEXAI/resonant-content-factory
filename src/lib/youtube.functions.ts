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
    const { fetchVideoStats } = await import("./youtube-stats.server");
    const { data: settings } = await supabase
      .from("integration_settings")
      .select("youtube_api_key")
      .eq("user_id", context.userId)
      .maybeSingle();
    const apiKey = settings?.youtube_api_key || process.env.YOUTUBE_API_KEY || null;
    const [meta, segments, stats] = await Promise.all([
      fetchOembed(videoId),
      fetchTranscript(videoId),
      fetchVideoStats(videoId, apiKey),
    ]);
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
      views: stats?.views ?? 0,
      reactions: stats?.likes ?? 0,
      comments_count: stats?.comments ?? 0,
      engagement_score: 0,
    };

    const { data: row, error } = await supabase
      .from("raw_materials")
      .upsert(payload, { onConflict: "external_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Fire-and-forget AI analysis so every source is auto-processed (даже без транскрипта).
    {
      const { analyzeMaterialById } = await import("./analyze.server");
      analyzeMaterialById(supabase, row.id).catch(e => console.error("auto-analyze failed", e));
    }
    return { id: row.id, source_type: "youtube_manual" as const, hasTranscript: segments.length > 0 };
  });

/** Refresh stats for all YouTube materials and analyze any without a summary. */
export const refreshAllMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase
      .from("integration_settings")
      .select("youtube_api_key")
      .eq("user_id", userId)
      .maybeSingle();
    const apiKey = settings?.youtube_api_key || process.env.YOUTUBE_API_KEY || null;

    const { data: materials } = await supabase
      .from("raw_materials")
      .select("id, external_id, raw_transcript, summary, source_type");
    const list = materials ?? [];
    const withVideoId = list.filter(m => !!m.external_id);

    let statsUpdated = 0;
    if (withVideoId.length) {
      const { fetchVideoStatsBatch } = await import("./youtube-stats.server");
      const map = await fetchVideoStatsBatch(
        withVideoId.map(m => m.external_id as string),
        apiKey,
      );
      for (const m of withVideoId) {
        const s = map.get(m.external_id as string);
        if (!s) continue;
        await supabase
          .from("raw_materials")
          .update({ views: s.views, reactions: s.likes, comments_count: s.comments })
          .eq("id", m.id);
        statsUpdated++;
      }
    }

    // Analyze anything that still lacks a summary but has a transcript.
    const toAnalyze = list.filter(m => !m.summary);
    let analyzed = 0;
    if (toAnalyze.length) {
      const { analyzeMaterialById } = await import("./analyze.server");
      for (const m of toAnalyze) {
        try {
          await analyzeMaterialById(supabase, m.id);
          analyzed++;
        } catch (e) {
          console.error("analyze failed", m.id, e);
        }
      }
    }
    return { statsUpdated, analyzed, apiKeyUsed: !!apiKey };
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
  .inputValidator((data: { playlist_id?: string | null; drive_folder_id?: string | null; youtube_api_key?: string | null }) =>
    z
      .object({
        playlist_id: z.string().max(200).nullish(),
        drive_folder_id: z.string().max(200).nullish(),
        youtube_api_key: z.string().max(200).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const playlist = data.playlist_id ? extractPlaylistId(data.playlist_id) ?? data.playlist_id.trim() : null;
    const update = {
      youtube_playlist_id: playlist,
      drive_folder_id: data.drive_folder_id?.trim() || null,
      ...(data.youtube_api_key !== undefined
        ? { youtube_api_key: data.youtube_api_key?.trim() || null }
        : {}),
    };
    const { error } = await supabase
      .from("integration_settings")
      .update(update as never)
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

/** Синхронизирует все активные YouTube-каналы в raw_materials (метаданные → Диск). */
export const syncAllSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncAllSourcesWith } = await import("./yt-sync.server");
    return await syncAllSourcesWith(context.supabase, context.userId);
  });

/** Проверка YouTube Data API: ключ задан и отвечает. */
export const checkYoutubeApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return { ok: false as const, hasKey: false, error: "Не задан секрет YOUTUBE_API_KEY" };
    try {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${key}`,
      );
      const body = await r.text();
      if (!r.ok) return { ok: false as const, hasKey: true, error: `YouTube API [${r.status}]: ${body.slice(0, 200)}` };
      return { ok: true as const, hasKey: true, error: null as string | null };
    } catch (e) {
      return { ok: false as const, hasKey: true, error: e instanceof Error ? e.message : String(e) };
    }
  });

/** Последние загруженные ролики из raw_materials. */
export const listRecentMaterials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("raw_materials")
      .select("id, title, channel_title, published_at, views, url, external_id, drive_file_id, drive_file_url, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
