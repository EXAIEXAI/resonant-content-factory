import { createFileRoute } from "@tanstack/react-router";

// Called by pg_cron every day at 08:00 (Europe/Moscow).
// Syncs all active YouTube channels (pulls new videos + refreshes stats)
// and analyzes any material still missing a summary.
export const Route = createFileRoute("/api/public/hooks/daily-refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Sync every active YouTube channel — pulls new videos via RSS.
        const { data: channels } = await supabaseAdmin
          .from("channels")
          .select("id, url, external_id, title, platform")
          .eq("active", true)
          .eq("platform", "youtube");

        // Lazy import to keep the module client-safe.
        const channelMod = await import("@/lib/channels.functions");
        // ingestChannel is not exported — re-implement via syncAllChannels logic by
        // calling the underlying RSS+upsert flow through the admin client.
        // We inline the loop here to avoid touching auth-scoped server fns.
        const { fetchVideoStatsBatch } = await import("@/lib/youtube-stats.server");
        const { analyzeMaterialById } = await import("@/lib/analyze.server");

        let channelsProcessed = 0;
        let added = 0;

        for (const ch of channels ?? []) {
          try {
            // Reuse the same shape by calling a temporary authless RPC:
            // simplest — hit the RSS feed inline.
            let channelId = ch.external_id;
            if (!channelId) {
              const m = ch.url.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/);
              if (m) channelId = m[1];
              else {
                const r = await fetch(ch.url, {
                  headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
                });
                if (r.ok) {
                  const html = await r.text();
                  channelId =
                    html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/)?.[1] ??
                    html.match(/\/channel\/(UC[a-zA-Z0-9_-]{20,})/)?.[1] ??
                    null;
                }
              }
            }
            if (!channelId) continue;

            const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
            if (!rss.ok) continue;
            const xml = await rss.text();

            const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
            let em: RegExpExecArray | null;
            const entries: { videoId: string; title: string; published: string; thumbnail: string | null }[] = [];
            while ((em = entryRe.exec(xml))) {
              const e = em[1];
              const videoId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
              if (!videoId) continue;
              entries.push({
                videoId,
                title: e.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || videoId,
                published: e.match(/<published>([^<]+)<\/published>/)?.[1] || new Date().toISOString(),
                thumbnail: e.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] || null,
              });
            }

            await supabaseAdmin
              .from("channels")
              .update({ external_id: channelId, last_polled_at: new Date().toISOString() })
              .eq("id", ch.id);

            for (const v of entries) {
              const { data: existing } = await supabaseAdmin
                .from("raw_materials")
                .select("id")
                .eq("external_id", v.videoId)
                .maybeSingle();
              await supabaseAdmin.from("raw_materials").upsert(
                {
                  external_id: v.videoId,
                  channel_id: ch.id,
                  title: v.title,
                  channel_title: ch.title,
                  url: `https://www.youtube.com/watch?v=${v.videoId}`,
                  thumbnail_url: v.thumbnail,
                  published_at: v.published,
                  source_type: "youtube_channel",
                  status: "found",
                  is_manual: false,
                  engagement_score: 0,
                },
                { onConflict: "external_id" },
              );
              if (!existing) added += 1;
            }
            channelsProcessed += 1;
          } catch (e) {
            console.error("daily-refresh channel failed", ch.id, e);
          }
        }

        // 2. Refresh stats for all YouTube materials using any available API key.
        const { data: settings } = await supabaseAdmin
          .from("integration_settings")
          .select("youtube_api_key")
          .not("youtube_api_key", "is", null)
          .limit(1)
          .maybeSingle();
        const apiKey = settings?.youtube_api_key || process.env.YOUTUBE_API_KEY || null;

        const { data: materials } = await supabaseAdmin
          .from("raw_materials")
          .select("id, external_id, summary");
        const list = materials ?? [];
        const withVid = list.filter(m => !!m.external_id);
        let statsUpdated = 0;
        if (withVid.length) {
          const map = await fetchVideoStatsBatch(withVid.map(m => m.external_id as string), apiKey);
          for (const m of withVid) {
            const s = map.get(m.external_id as string);
            if (!s) continue;
            await supabaseAdmin
              .from("raw_materials")
              .update({ views: s.views, reactions: s.likes, comments_count: s.comments })
              .eq("id", m.id);
            statsUpdated += 1;
          }
        }

        // 3. Analyze anything without a summary.
        let analyzed = 0;
        for (const m of list.filter(x => !x.summary)) {
          try {
            await analyzeMaterialById(supabaseAdmin as never, m.id);
            analyzed += 1;
          } catch (e) {
            console.error("daily-refresh analyze failed", m.id, e);
          }
        }

        return Response.json({
          ok: true,
          channelsProcessed,
          added,
          statsUpdated,
          analyzed,
          at: new Date().toISOString(),
        });
      },
    },
  },
});

// Touch to keep tree-shaker happy for module import above.
void (async () => { void (await import("@/lib/channels.functions")).syncAllChannels; });
