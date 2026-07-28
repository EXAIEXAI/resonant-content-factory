// Client-safe helpers for parsing YouTube URLs.

export function extractYoutubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Bare 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex(p => p === "shorts" || p === "embed" || p === "v" || p === "live");
      if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) return parts[idx + 1];
    }
  } catch {
    return null;
  }
  return null;
}

export function extractPlaylistId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^PL[a-zA-Z0-9_-]{10,}$/.test(s) || /^[A-Z]{2}[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const list = u.searchParams.get("list");
    if (list) return list;
  } catch {}
  return null;
}

export function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function youtubeTimestampUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}
