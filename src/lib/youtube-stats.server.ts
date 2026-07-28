// Fetches YouTube video stats. Prefers the official Data API v3 when an API key
// is provided (reliable), otherwise falls back to best-effort scraping.

export type VideoStats = {
  views: number;
  likes: number;
  comments: number;
};

function parseCompact(s: string): number {
  const clean = s.replace(/\s|\u00A0/g, "").replace(/,/g, "");
  const m = clean.match(/^([\d.]+)([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2]?.toUpperCase();
  const mult = u === "K" ? 1e3 : u === "M" ? 1e6 : u === "B" ? 1e9 : 1;
  return Math.round(n * mult);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchViaApi(videoId: string, apiKey: string): Promise<VideoStats | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${apiKey}`,
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const s = j.items?.[0]?.statistics;
    if (!s) return null;
    return {
      views: parseInt(s.viewCount ?? "0", 10) || 0,
      likes: parseInt(s.likeCount ?? "0", 10) || 0,
      comments: parseInt(s.commentCount ?? "0", 10) || 0,
    };
  } catch {
    return null;
  }
}

async function fetchViaApiBatch(ids: string[], apiKey: string): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&key=${apiKey}`,
      );
      if (!r.ok) continue;
      const j: any = await r.json();
      for (const it of j.items ?? []) {
        const s = it.statistics ?? {};
        out.set(it.id, {
          views: parseInt(s.viewCount ?? "0", 10) || 0,
          likes: parseInt(s.likeCount ?? "0", 10) || 0,
          comments: parseInt(s.commentCount ?? "0", 10) || 0,
        });
      }
    } catch {
      // continue
    }
  }
  return out;
}

async function fetchWatchStats(videoId: string): Promise<{ views: number; likes: number } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const views = parseInt(html.match(/"viewCount":"(\d+)"/)?.[1] ?? "0", 10) || 0;
    const likes = parseInt(html.match(/"likeCount":"(\d+)"/)?.[1] ?? "0", 10) || 0;
    return { views, likes };
  } catch {
    return null;
  }
}

async function fetchCommentCount(videoId: string): Promise<number> {
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en" } },
        videoId,
      }),
    });
    if (!r.ok) return 0;
    const t = await r.text();
    const m =
      t.match(/"commentsEntryPointHeaderRenderer"[\s\S]{0,800}?"contextualInfo":\{"runs":\[\{"text":"([\d.,KMB\s]+)"/) ||
      t.match(/"contextualInfo":\{"runs":\[\{"text":"([\d.,KMB\s]+)"/);
    if (m) return parseCompact(m[1]);
    return 0;
  } catch {
    return 0;
  }
}

export async function fetchVideoStats(videoId: string, apiKey?: string | null): Promise<VideoStats | null> {
  if (apiKey) {
    const api = await fetchViaApi(videoId, apiKey);
    if (api) return api;
  }
  const [watch, comments] = await Promise.all([fetchWatchStats(videoId), fetchCommentCount(videoId)]);
  if (!watch) return null;
  return { views: watch.views, likes: watch.likes, comments };
}

export async function fetchVideoStatsBatch(
  ids: string[],
  apiKey?: string | null,
): Promise<Map<string, VideoStats>> {
  if (apiKey) return fetchViaApiBatch(ids, apiKey);
  const out = new Map<string, VideoStats>();
  await Promise.all(
    ids.map(async id => {
      const s = await fetchVideoStats(id, null);
      if (s) out.set(id, s);
    }),
  );
  return out;
}
