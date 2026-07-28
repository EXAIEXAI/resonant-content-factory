// Best-effort scraping of public YouTube stats without an API key.

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

export async function fetchVideoStats(videoId: string): Promise<VideoStats | null> {
  const [watch, comments] = await Promise.all([fetchWatchStats(videoId), fetchCommentCount(videoId)]);
  if (!watch) return null;
  return { views: watch.views, likes: watch.likes, comments };
}
