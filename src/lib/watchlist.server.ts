// Server-only: сбор роликов из личного плейлиста YouTube («Сохранить» → плейлист) в raw_materials.
// Работает от имени конкретного пользователя (его OAuth + его папка на Диске).
import type { SupabaseClient } from "@supabase/supabase-js";
import { iso8601ToSeconds } from "./yt-sync.server";
import { getUserGoogleToken } from "./google.server";

type AnyClient = SupabaseClient<any, any, any>;

export type WatchlistSyncResult = {
  playlistId: string;
  apiReturned: number;
  skippedDuplicates: number;
  added: number;
  addedIds: string[];
  errors: string[];
};

async function getJson(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`YouTube API [${r.status}]: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function fetchTranscript(videoId: string): Promise<{ start: number; dur: number; text: string }[]> {
  for (const lang of ["ru", "en"]) {
    try {
      const r = await fetch(`https://video.google.com/timedtext?lang=${lang}&v=${videoId}`);
      if (!r.ok) continue;
      const xml = await r.text();
      if (!xml.trim()) continue;
      const re = /<text[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
      const segs: { start: number; dur: number; text: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) {
        const text = m[3]
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, "").trim();
        if (text) segs.push({ start: parseFloat(m[1]), dur: parseFloat(m[2] ?? "0"), text });
      }
      if (segs.length) return segs;
    } catch {
      continue;
    }
  }
  return [];
}

/** Тянет все ролики из плейлиста и добавляет отсутствующие в raw_materials. */
export async function syncWatchlistPlaylist(
  supabase: AnyClient,
  userId: string,
  playlistId: string,
): Promise<WatchlistSyncResult> {
  const token = await getUserGoogleToken(userId, "youtube");
  const res: WatchlistSyncResult = { playlistId, apiReturned: 0, skippedDuplicates: 0, added: 0, addedIds: [], errors: [] };

  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const j: any = await getJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(
        playlistId,
      )}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    for (const it of j?.items ?? []) {
      res.apiReturned++;
      const vid = it?.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = j?.nextPageToken;
    if (!pageToken) break;
  }
  if (!ids.length) return res;

  const { data: known } = await supabase
    .from("raw_materials")
    .select("external_id")
    .eq("user_id", userId)
    .in("external_id", ids);
  const knownSet = new Set((known ?? []).map((r: any) => r.external_id));
  const targets = ids.filter(id => !knownSet.has(id));
  res.skippedDuplicates = ids.length - targets.length;
  if (!targets.length) return res;

  const videos: any[] = [];
  for (let i = 0; i < targets.length; i += 50) {
    const chunk = targets.slice(i, i + 50);
    const j: any = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${chunk.join(",")}`,
      token,
    );
    videos.push(...(j?.items ?? []));
  }

  const { analyzeMaterialById } = await import("./analyze.server");
  const { driveUploadText } = await import("./gdrive.server");

  for (const v of videos) {
    try {
      const videoId: string = v.id;
      const sn = v.snippet ?? {};
      const st = v.statistics ?? {};
      const th = sn.thumbnails ?? {};
      const segments = await fetchTranscript(videoId);
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      let driveFileId: string | null = null;
      let driveFileUrl: string | null = null;
      try {
        const file = await driveUploadText(
          userId,
          `[YT] ${String(sn.title ?? videoId).replace(/[\\/:*?"<>|]/g, " ").slice(0, 120)}_${videoId}.json`,
          JSON.stringify(
            {
              video_id: videoId,
              source: "youtube_saved",
              playlist_id: playlistId,
              channel_id: sn.channelId ?? null,
              channel_title: sn.channelTitle ?? null,
              title: sn.title ?? "",
              description: sn.description ?? "",
              published_at: sn.publishedAt ?? null,
              duration: v?.contentDetails?.duration ?? null,
              statistics: st,
              url,
              transcript: segments.map(s => s.text).join(" "),
              transcript_segments: segments,
            },
            null,
            2,
          ),
          "application/json",
        );
        driveFileId = file.id;
        driveFileUrl = file.webViewLink;
      } catch (e) {
        res.errors.push(`Drive ${videoId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      const { data: row, error } = await supabase
        .from("raw_materials")
        .upsert(
          {
            user_id: userId,
            external_id: videoId,
            title: sn.title ?? url,
            channel_title: sn.channelTitle ?? null,
            url,
            thumbnail_url: (th.high ?? th.medium ?? th.default)?.url ?? null,
            published_at: sn.publishedAt ?? null,
            duration_seconds: iso8601ToSeconds(v?.contentDetails?.duration),
            views: Number(st.viewCount ?? 0) || 0,
            reactions: Number(st.likeCount ?? 0) || 0,
            comments_count: Number(st.commentCount ?? 0) || 0,
            raw_transcript: segments.length ? segments.map(s => s.text).join(" ") : null,
            transcript_segments: segments,
            drive_file_id: driveFileId,
            drive_file_url: driveFileUrl,
            is_manual: true,
            source_type: "youtube_saved",
            status: "found",
            engagement_score: 0,
            added_by: userId,
          },
          { onConflict: "user_id,external_id" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      res.added++;
      res.addedIds.push(row.id);
      analyzeMaterialById(supabase, row.id).catch(e => console.error("watchlist analyze failed", e));
    } catch (e) {
      res.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return res;
}
