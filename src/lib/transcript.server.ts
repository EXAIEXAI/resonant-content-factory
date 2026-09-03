export type TranscriptSegment = { start: number; dur: number; text: string };

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

/** Пытается получить субтитры с таймкодами для ролика YouTube. */
export async function fetchTranscriptSegments(videoId: string): Promise<TranscriptSegment[]> {
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
