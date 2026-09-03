export type TranscriptSegment = { start: number; dur: number; text: string };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const re = /<text[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = decode(m[3]);
    if (!text) continue;
    out.push({ start: parseFloat(m[1]), dur: parseFloat(m[2] ?? "0"), text });
  }
  return out;
}

function parseTimedTextJson3(json: string): TranscriptSegment[] {
  try {
    const j = JSON.parse(json);
    const out: TranscriptSegment[] = [];
    for (const ev of j?.events ?? []) {
      const text = (ev.segs ?? []).map((s: any) => s.utf8 ?? "").join("").replace(/\n/g, " ").trim();
      if (!text) continue;
      out.push({ start: (ev.tStartMs ?? 0) / 1000, dur: (ev.dDurationMs ?? 0) / 1000, text });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchWatchHtml(videoId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ru`, {
      headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8" },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/** Достаёт список дорожек субтитров (в т.ч. авто) со страницы ролика. */
function extractCaptionTracks(html: string): { baseUrl: string; lang: string; kind?: string }[] {
  const m = html.match(/"captionTracks":(\[[\s\S]*?\])/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1].replace(/\\u0026/g, "&"));
    return arr
      .map((t: any) => ({ baseUrl: String(t.baseUrl ?? "").replace(/\\u0026/g, "&"), lang: String(t.languageCode ?? ""), kind: t.kind }))
      .filter((t: any) => t.baseUrl);
  } catch {
    return [];
  }
}

/** Пытается получить субтитры с таймкодами для ролика YouTube. */
export async function fetchTranscriptSegments(videoId: string): Promise<TranscriptSegment[]> {
  const html = await fetchWatchHtml(videoId);
  if (html) {
    const tracks = extractCaptionTracks(html);
    const order = ["ru", "en"];
    tracks.sort((a, b) => {
      const ai = order.indexOf(a.lang) === -1 ? 9 : order.indexOf(a.lang);
      const bi = order.indexOf(b.lang) === -1 ? 9 : order.indexOf(b.lang);
      return ai - bi;
    });
    for (const t of tracks) {
      for (const fmt of ["&fmt=json3", ""]) {
        try {
          const r = await fetch(t.baseUrl + fmt, { headers: { "User-Agent": UA } });
          if (!r.ok) continue;
          const body = await r.text();
          if (!body.trim()) continue;
          const segs = fmt ? parseTimedTextJson3(body) : parseTimedTextXml(body);
          if (segs.length) return segs;
        } catch {
          continue;
        }
      }
    }
  }

  // Устаревший запасной путь.
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

export type YtChapter = { start: number; title: string };

function hmsToSeconds(t: string): number {
  const parts = t.split(":").map(n => parseInt(n, 10));
  if (parts.some(isNaN)) return -1;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Главы, которые автор указал в описании / разметил в плеере. */
export async function fetchYoutubeChapters(videoId: string): Promise<YtChapter[]> {
  const html = await fetchWatchHtml(videoId);
  if (!html) return [];

  // 1) Официальная разметка глав в плеере.
  const out: YtChapter[] = [];
  const chapRe = /"chapterRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"\},"timeRangeStartMillis":(\d+)/g;
  let cm: RegExpExecArray | null;
  while ((cm = chapRe.exec(html))) {
    let title = cm[1];
    try {
      title = JSON.parse(`"${title}"`);
    } catch {
      /* keep raw */
    }
    out.push({ start: Math.floor(parseInt(cm[2], 10) / 1000), title: title.trim() });
  }
  if (out.length >= 2) return out.sort((a, b) => a.start - b.start);

  // 2) Таймкоды в описании.
  const dm = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (!dm) return [];
  let desc = "";
  try {
    desc = JSON.parse(`"${dm[1]}"`);
  } catch {
    return [];
  }
  const fromDesc: YtChapter[] = [];
  for (const line of desc.split(/\r?\n/)) {
    const lm = line.match(/^\s*[-•]?\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:.)]?\s*(.+)$/);
    if (!lm) continue;
    const start = hmsToSeconds(lm[1]);
    const title = lm[2].trim();
    if (start < 0 || !title) continue;
    fromDesc.push({ start, title });
  }
  if (fromDesc.length >= 2 && fromDesc[0].start <= 5) return fromDesc.sort((a, b) => a.start - b.start);
  return fromDesc.length >= 3 ? fromDesc.sort((a, b) => a.start - b.start) : [];
}
