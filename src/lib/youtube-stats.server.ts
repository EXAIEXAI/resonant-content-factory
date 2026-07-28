// Best-effort scraping of public YouTube stats without an API key.
// Extracts views, likes, comments from the watch page HTML.

export type VideoStats = {
  views: number;
  likes: number;
  comments: number;
};

function parseCompact(s: string): number {
  // "1,234" | "1.2K" | "3.4M" | "1.1B"
  const clean = s.replace(/\s|\u00A0/g, "").replace(/,/g, "");
  const m = clean.match(/^([\d.]+)([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = m[2]?.toUpperCase() === "K" ? 1e3 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "B" ? 1e9 : 1;
  return Math.round(n * mult);
}

export async function fetchVideoStats(videoId: string): Promise<VideoStats | null> {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!r.ok) return null;
    const html = await r.text();

    const views = parseInt(html.match(/"viewCount":"(\d+)"/)?.[1] ?? "0", 10) || 0;

    let likes = 0;
    const likeLabel =
      html.match(/"accessibilityData":\{"label":"([^"]*?like this video[^"]*?)"\}/i)?.[1] ||
      html.match(/"label":"([^"]*?likes?[^"]*?)"/i)?.[1];
    if (likeLabel) {
      const num = likeLabel.match(/([\d.,\s]+)\s*(?:other people|others|likes?)/i)?.[1];
      if (num) likes = parseCompact(num);
    }
    if (!likes) {
      const alt = html.match(/"defaultText":\{[^}]*"simpleText":"([\d.,KMB]+)"[^}]*\}[^}]*"Likes"/)?.[1];
      if (alt) likes = parseCompact(alt);
    }

    let comments = 0;
    const c1 = html.match(/"commentCount":\{"simpleText":"([\d.,KMB\s]+)"\}/)?.[1];
    if (c1) comments = parseCompact(c1);
    if (!comments) {
      const c2 = html.match(/"commentCount":"(\d+)"/)?.[1];
      if (c2) comments = parseInt(c2, 10);
    }

    return { views, likes, comments };
  } catch {
    return null;
  }
}
