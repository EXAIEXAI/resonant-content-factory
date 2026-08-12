import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WORKSPACE_OWNER_ID } from "./workspace";

/** Resolve a YouTube channel URL to a UC... channel id. Works for /channel/UC..., /@handle, /c/name, /user/name. */
async function resolveChannelId(url: string): Promise<{ channelId: string; title: string | null } | null> {
  const m = url.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
  if (m) return { channelId: m[1], title: null };
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const idMatch =
      html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/) ||
      html.match(/<meta itemprop="identifier" content="(UC[a-zA-Z0-9_-]{20,})">/) ||
      html.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
    if (!idMatch) return null;
    const titleMatch =
      html.match(/<meta property="og:title" content="([^"]+)"/) ||
      html.match(/<title>([^<]+)<\/title>/);
    return { channelId: idMatch[1], title: titleMatch ? titleMatch[1].replace(/ - YouTube$/, "").trim() : null };
  } catch {
    return null;
  }
}

type RssEntry = {
  videoId: string;
  title: string;
  published: string;
  thumbnail: string | null;
  views: number;
  channelTitle: string | null;
};

function parseChannelRss(xml: string): { channelTitle: string | null; entries: RssEntry[] } {
  const channelTitle = (xml.match(/<title>([^<]+)<\/title>/)?.[1] || null)?.trim() || null;
  const entries: RssEntry[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const videoId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!videoId) continue;
    const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || videoId;
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1] || new Date().toISOString();
    const thumbnail = e.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] || null;
    const views = parseInt(e.match(/<media:statistics[^>]*views="(\d+)"/)?.[1] || "0", 10) || 0;
    const chTitle = e.match(/<name>([^<]+)<\/name>/)?.[1] || null;
    entries.push({ videoId, title, published, thumbnail, views, channelTitle: chTitle });
  }
  return { channelTitle, entries };
}

async function ingestChannel(
  supabase: any,
  userId: string,
  channelRow: { id: string; url: string; external_id: string | null; title: string },
): Promise<{ resolved: boolean; added: number; total: number; message?: string }> {

  let channelId = channelRow.external_id;
  let resolvedTitle: string | null = null;

  if (!channelId) {
    const r = await resolveChannelId(channelRow.url);
    if (!r) return { resolved: false, added: 0, total: 0, message: "Не удалось определить ID канала" };
    channelId = r.channelId;
    resolvedTitle = r.title;
  }

  const rssRes = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!rssRes.ok) return { resolved: true, added: 0, total: 0, message: `RSS ${rssRes.status}` };
  const xml = await rssRes.text();
  const { channelTitle, entries } = parseChannelRss(xml);

  const finalTitle = resolvedTitle || channelTitle || channelRow.title;
  await supabase
    .from("channels")
    .update({
      external_id: channelId,
      title: finalTitle,
      last_polled_at: new Date().toISOString(),
    })
    .eq("id", channelRow.id);

  let added = 0;
  for (const v of entries) {
    const canonicalUrl = `https://www.youtube.com/watch?v=${v.videoId}`;
    const { data: existing } = await supabase
      .from("raw_materials")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", v.videoId)
      .maybeSingle();

    const payload = {
      user_id: userId,
      added_by: userId,
      external_id: v.videoId,
      channel_id: channelRow.id,
      title: v.title,
      channel_title: v.channelTitle || finalTitle,
      url: canonicalUrl,
      thumbnail_url: v.thumbnail,
      published_at: v.published,
      views: v.views,
      source_type: "youtube_channel",
      status: "found",
      is_manual: false,
      engagement_score: 0,
    };

    const { data: row, error } = await supabase
      .from("raw_materials")
      .upsert(payload, { onConflict: "user_id,external_id" })
      .select()
      .single();

    if (error) continue;
    if (!existing) added += 1;

    // Refresh real stats (views/likes/comments) from the watch page — best-effort.
    (async () => {
      try {
        const { fetchVideoStats } = await import("./youtube-stats.server");
        const stats = await fetchVideoStats(v.videoId);
        if (stats) {
          await supabase
            .from("raw_materials")
            .update({ views: stats.views, reactions: stats.likes, comments_count: stats.comments })
            .eq("id", row.id);
        }
      } catch (e) {
        console.error("stats fetch failed", v.videoId, e);
      }
    })();

    // Try to pull captions + trigger AI analysis in the background (best-effort).
    if (!existing) {
      (async () => {
        try {
          for (const lang of ["ru", "en"]) {
            const cap = await fetch(`https://video.google.com/timedtext?lang=${lang}&v=${v.videoId}`);
            if (!cap.ok) continue;
            const capXml = await cap.text();
            if (!capXml.trim()) continue;
            const segRe = /<text[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
            const segs: { start: number; dur: number; text: string }[] = [];
            let mm: RegExpExecArray | null;
            while ((mm = segRe.exec(capXml))) {
              const t = mm[3]
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/<[^>]+>/g, "").trim();
              if (t) segs.push({ start: parseFloat(mm[1]), dur: parseFloat(mm[2] ?? "0"), text: t });
            }
            if (segs.length) {
              await supabase
                .from("raw_materials")
                .update({ raw_transcript: segs.map(s => s.text).join(" "), transcript_segments: segs })
                .eq("id", row.id);
              const { analyzeMaterialById } = await import("./analyze.server");
              await analyzeMaterialById(supabase, row.id);
              break;
            }
          }
        } catch (e) {
          console.error("channel video enrich failed", v.videoId, e);
        }
      })();
    }
  }

  return { resolved: true, added, total: entries.length };
}

export const syncChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { channelId: string }) =>
    z.object({ channelId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = WORKSPACE_OWNER_ID;
    const { data: ch, error } = await supabase
      .from("channels")
      .select("id, url, external_id, title, platform")
      .eq("id", data.channelId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !ch) throw new Error("Канал не найден");
    if (ch.platform !== "youtube") {
      return { resolved: false, added: 0, total: 0, message: "Автосинхронизация пока только для YouTube" };
    }
    return ingestChannel(supabase, userId, ch as any);
  });

export const syncAllChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = WORKSPACE_OWNER_ID;
    const { data: chs } = await supabase
      .from("channels")
      .select("id, url, external_id, title, platform")
      .eq("user_id", userId)
      .eq("active", true)
      .eq("platform", "youtube");
    let added = 0;
    let processed = 0;
    for (const ch of chs ?? []) {
      try {
        const r = await ingestChannel(supabase, userId, ch as any);

        added += r.added;
        processed += 1;
      } catch (e) {
        console.error("syncAll channel failed", ch.id, e);
      }
    }
    return { channels: processed, added };
  });
