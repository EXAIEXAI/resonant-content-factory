// Периодический опрос личных плейлистов YouTube («Сохранить» → плейлист).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/watchlist")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncWatchlistPlaylist } = await import("@/lib/watchlist.server");

        const { data: rows, error } = await supabaseAdmin
          .from("integration_settings")
          .select("user_id, youtube_playlist_id, youtube_api_key")
          .not("youtube_playlist_id", "is", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results = [];
        for (const s of rows ?? []) {
          const playlistId = s.youtube_playlist_id?.trim();
          if (!playlistId) continue;
          try {
            const r = await syncWatchlistPlaylist(supabaseAdmin, s.user_id, playlistId, s.youtube_api_key ?? null);
            await supabaseAdmin
              .from("integration_settings")
              .update({ last_sync_at: new Date().toISOString(), last_sync_count: r.added })
              .eq("user_id", s.user_id);
            results.push(r);
          } catch (e) {
            results.push({
              playlistId,
              apiReturned: 0,
              skippedDuplicates: 0,
              added: 0,
              errors: [e instanceof Error ? e.message : String(e)],
            });
          }
        }
        return Response.json({ ok: true, results, ranAt: new Date().toISOString() });
      },
    },
  },
});
