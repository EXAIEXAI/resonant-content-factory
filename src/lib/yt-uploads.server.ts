// Server-only helpers for the YouTube Data API v3 (uploads playlist).

export type Upload = {
  videoId: string;
  title: string;
  publishedAt: string | null;
  thumbnail: string | null;
  url: string;
};

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("Не задан секрет YOUTUBE_API_KEY");
  return key;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok) throw new Error(`YouTube API [${r.status}]: ${body}`);
  return JSON.parse(body);
}

export async function getUploadsPlaylistId(channelId: string): Promise<string> {
  const key = apiKey();
  const isId = /^UC[\w-]{20,}$/.test(channelId);
  const url = isId
    ? `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${key}`
    : `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(
        channelId.replace(/^@/, "@"),
      )}&key=${key}`;
  const j = await getJson(url);
  const pid = j?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!pid) throw new Error(`Канал не найден: ${channelId}`);
  return pid;
}

export async function fetchUploads(channelId: string, maxResults: number): Promise<Upload[]> {
  const key = apiKey();
  const playlistId = await getUploadsPlaylistId(channelId);
  const j = await getJson(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${Math.min(
      Math.max(maxResults, 1),
      50,
    )}&playlistId=${encodeURIComponent(playlistId)}&key=${key}`,
  );
  return (j?.items ?? []).map((it: any): Upload => {
    const videoId = it?.contentDetails?.videoId ?? it?.snippet?.resourceId?.videoId;
    const th = it?.snippet?.thumbnails ?? {};
    return {
      videoId,
      title: it?.snippet?.title ?? "",
      publishedAt: it?.contentDetails?.videoPublishedAt ?? it?.snippet?.publishedAt ?? null,
      thumbnail: (th.high ?? th.medium ?? th.default)?.url ?? null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }).filter((u: Upload) => !!u.videoId);
}
