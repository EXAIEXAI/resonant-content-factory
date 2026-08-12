// Server-only: синхронизация каналов YouTube → Google Drive → raw_materials.
// Всё выполняется от имени конкретного пользователя (его OAuth-токен, его данные).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getYoutubeAuth, ytFetch, type YtAuth } from "./google.server";

type AnyClient = SupabaseClient<any, any, any>;

export type ChannelSyncResult = {
  channel: string;
  apiReturned: number;
  skippedByDate: number;
  skippedDuplicates: number;
  backfilled: number;
  found: number;
  added: number;
  errors: string[];
};

async function getJson(url: string, token: YtAuth): Promise<any> {
  const r = await ytFetch(url, token);
  const body = await r.text();
  if (!r.ok) throw new Error(`YouTube API [${r.status}]: ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

/** ISO8601 duration (PT1H2M3S) → секунды. */
export function iso8601ToSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return +(d ?? 0) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0);
}

type ResolvedChannel = { channelId: string; title: string; subscribers: number; uploads: string };

/** Резолвит канал из ссылки: /channel/UC..., /@handle, /c/..., /user/... */
export async function resolveChannel(url: string, token: YtAuth): Promise<ResolvedChannel> {
  const base = "https://www.googleapis.com/youtube/v3";
  const part = "part=snippet,statistics,contentDetails";

  const clean = url.trim();
  let query: string | null = null;

  const byId = /youtube\.com\/channel\/(UC[\w-]{20,})/i.exec(clean) ?? /^(UC[\w-]{20,})$/.exec(clean);
  const byHandle = /youtube\.com\/@([\w.\-]+)/i.exec(clean) ?? /^@([\w.\-]+)$/.exec(clean);
  const byLegacy = /youtube\.com\/(?:c|user)\/([\w.\-]+)/i.exec(clean);

  if (byId) query = `${base}/channels?${part}&id=${encodeURIComponent(byId[1])}`;
  else if (byHandle) query = `${base}/channels?${part}&forHandle=${encodeURIComponent(byHandle[1])}`;

  let item: any = null;
  if (query) item = (await getJson(query, token))?.items?.[0] ?? null;

  if (!item) {
    const term = byLegacy?.[1] ?? byHandle?.[1] ?? clean;
    const search = await getJson(
      `${base}/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(term)}`,
      token,
    );
    const cid = search?.items?.[0]?.snippet?.channelId ?? search?.items?.[0]?.id?.channelId;
    if (cid) item = (await getJson(`${base}/channels?${part}&id=${encodeURIComponent(cid)}`, token))?.items?.[0];
  }

  if (!item) throw new Error(`Канал не найден по ссылке: ${clean}`);
  const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`У канала нет плейлиста загрузок: ${clean}`);

  return {
    channelId: item.id,
    title: item?.snippet?.title ?? clean,
    subscribers: Number(item?.statistics?.subscriberCount ?? 0) || 0,
    uploads,
  };
}

type PlaylistEntry = { videoId: string; publishedAt: string | null };

async function listPlaylist(
  uploads: string,
  since: Date,
  token: YtAuth,
): Promise<{ entries: PlaylistEntry[]; apiReturned: number; skippedByDate: number }> {
  const out: PlaylistEntry[] = [];
  let apiReturned = 0;
  let skippedByDate = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const j: any = await getJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(
        uploads,
      )}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    let stop = false;
    for (const it of j?.items ?? []) {
      apiReturned++;
      const videoId = it?.contentDetails?.videoId;
      const publishedAt = it?.contentDetails?.videoPublishedAt ?? null;
      if (!videoId) continue;
      if (publishedAt && new Date(publishedAt) <= since) {
        stop = true;
        skippedByDate++;
        continue;
      }
      out.push({ videoId, publishedAt });
    }
    pageToken = j?.nextPageToken;
    if (stop || !pageToken) break;
  }
  return { entries: out, apiReturned, skippedByDate };
}

async function fetchVideos(ids: string[], token: YtAuth): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j: any = await getJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${chunk.join(",")}`,
      token,
    );
    out.push(...(j?.items ?? []));
  }
  return out;
}

/** Синхронизирует активные YouTube-каналы пользователя: новые ролики → Drive → raw_materials. */
export async function syncAllSourcesWith(
  supabase: AnyClient,
  userId: string,
  /** Если задан — граница выборки «сейчас минус sinceDays», last_polled_at игнорируется. */
  sinceDays?: number | null,
): Promise<{ results: ChannelSyncResult[]; totalAdded: number; ranAt: string }> {
  const token = await getYoutubeAuth(userId);

  const { data: channels, error } = await supabase
    .from("channels")
    .select("id, url, title, external_id, last_polled_at")
    .eq("user_id", userId)
    .eq("platform", "youtube")
    .eq("active", true);
  if (error) throw new Error(error.message);

  const { driveUploadText } = await import("./gdrive.server");
  const results: ChannelSyncResult[] = [];
  let totalAdded = 0;

  for (const ch of channels ?? []) {
    const res: ChannelSyncResult = {
      channel: ch.title || ch.url,
      apiReturned: 0,
      skippedByDate: 0,
      skippedDuplicates: 0,
      backfilled: 0,
      found: 0,
      added: 0,
      errors: [],
    };

    try {
      const resolved = await resolveChannel(ch.url, token);
      res.channel = resolved.title;
      await supabase
        .from("channels")
        .update({ external_id: resolved.channelId, title: resolved.title, subscribers: resolved.subscribers })
        .eq("id", ch.id);

      const since =
        sinceDays && sinceDays > 0
          ? new Date(Date.now() - sinceDays * 24 * 3600 * 1000)
          : ch.last_polled_at
            ? new Date(ch.last_polled_at)
            : new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const poll = await listPlaylist(resolved.uploads, since, token);
      const entries = poll.entries;
      res.apiReturned = poll.apiReturned;
      res.skippedByDate = poll.skippedByDate;
      res.found = entries.length;
      if (!entries.length) {
        if (sinceDays && sinceDays > 0) {
          await supabase.from("channels").update({ last_polled_at: new Date().toISOString() }).eq("id", ch.id);
        }
        results.push(res);
        continue;
      }

      type KnownRow = {
        id: string;
        external_id: string | null;
        drive_file_id: string | null;
        views: number | null;
        reactions: number | null;
        comments_count: number | null;
        duration_seconds: number | null;
        thumbnail_url: string | null;
      };
      const { data: known } = await supabase
        .from("raw_materials")
        .select("id, external_id, drive_file_id, views, reactions, comments_count, duration_seconds, thumbnail_url")
        .eq("user_id", userId)
        .in("external_id", entries.map(e => e.videoId));
      const knownMap = new Map<string, KnownRow>();
      for (const r of (known ?? []) as KnownRow[]) {
        if (r.external_id) knownMap.set(r.external_id, r);
      }
      // Дубль = строка существует И у неё есть файл на Диске. Иначе — дозаполняем.
      const targets = entries.filter(e => {
        const row = knownMap.get(e.videoId);
        return !row || !row.drive_file_id;
      });
      res.skippedDuplicates = entries.length - targets.length;
      res.found = targets.length;

      if (!targets.length) {
        if (sinceDays && sinceDays > 0) {
          await supabase.from("channels").update({ last_polled_at: new Date().toISOString() }).eq("id", ch.id);
        }
        results.push(res);
        continue;
      }

      const videos = await fetchVideos(targets.map(e => e.videoId), token);
      let newest: string | null = ch.last_polled_at ?? null;

      for (const v of videos) {
        try {
          const videoId: string = v.id;
          const sn = v.snippet ?? {};
          const st = v.statistics ?? {};
          const th = sn.thumbnails ?? {};
          const publishedAt: string | null = sn.publishedAt ?? null;
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
                  channel_id: resolved.channelId,
                  channel_title: sn.channelTitle ?? resolved.title,
                  title: sn.title ?? "",
                  description: sn.description ?? "",
                  published_at: publishedAt,
                  duration: v?.contentDetails?.duration ?? null,
                  statistics: st,
                  url,
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

          const existing = knownMap.get(videoId);
          const apiViews = Number(st.viewCount ?? 0) || 0;
          const apiLikes = Number(st.likeCount ?? 0) || 0;
          const apiComments = Number(st.commentCount ?? 0) || 0;
          const apiDuration = iso8601ToSeconds(v?.contentDetails?.duration);
          const apiThumb = (th.high ?? th.medium ?? th.default)?.url ?? null;

          if (existing) {
            const patch: Record<string, unknown> = {};
            if (driveFileId) {
              patch.drive_file_id = driveFileId;
              patch.drive_file_url = driveFileUrl;
            }
            if (!existing.views && apiViews) patch.views = apiViews;
            if (!existing.reactions && apiLikes) patch.reactions = apiLikes;
            if (!existing.comments_count && apiComments) patch.comments_count = apiComments;
            if (!existing.duration_seconds && apiDuration) patch.duration_seconds = apiDuration;
            if (!existing.thumbnail_url && apiThumb) patch.thumbnail_url = apiThumb;

            if (Object.keys(patch).length) {
              const { error: updErr } = await supabase.from("raw_materials").update(patch).eq("id", existing.id);
              if (updErr) throw new Error(updErr.message);
            }
            res.backfilled++;
            if (publishedAt && (!newest || new Date(publishedAt) > new Date(newest))) newest = publishedAt;
            continue;
          }

          const row = {
            user_id: userId,
            external_id: videoId,
            channel_id: ch.id,
            channel_title: sn.channelTitle ?? resolved.title,
            title: sn.title ?? url,
            url,
            published_at: publishedAt,
            duration_seconds: apiDuration,
            thumbnail_url: apiThumb,
            drive_file_id: driveFileId,
            drive_file_url: driveFileUrl,
            source_type: "youtube_channel",
            is_manual: false,
            status: "found",
            views: apiViews,
            reactions: apiLikes,
            comments_count: apiComments,
            engagement_score: 0,
            raw_transcript: null,
            transcript_segments: [],
            added_by: userId,
          };

          const { error: upErr } = await supabase
            .from("raw_materials")
            .upsert(row, { onConflict: "user_id,external_id" });
          if (upErr) throw new Error(upErr.message);

          res.added++;
          totalAdded++;
          if (publishedAt && (!newest || new Date(publishedAt) > new Date(newest))) newest = publishedAt;
        } catch (e) {
          res.errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      const stamp = sinceDays && sinceDays > 0 ? new Date().toISOString() : newest;
      if (stamp) await supabase.from("channels").update({ last_polled_at: stamp }).eq("id", ch.id);
    } catch (e) {
      res.errors.push(e instanceof Error ? e.message : String(e));
    }
    results.push(res);
  }

  return { results, totalAdded, ranAt: new Date().toISOString() };
}
