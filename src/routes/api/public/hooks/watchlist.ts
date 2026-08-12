// Периодический опрос личных плейлистов YouTube («Сохранить» → плейлист).
import { createFileRoute } from "@tanstack/react-router";
import { WORKSPACE_OWNER_ID } from "@/lib/workspace";

export const Route = createFileRoute("/api/public/hooks/watchlist")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncWatchlistPlaylist } = await import("@/lib/watchlist.server");
        const { sendMaterialsNow } = await import("@/lib/telegram.server");

        const { data: rows, error } = await supabaseAdmin
          .from("integration_settings")
          .select("user_id, youtube_playlist_id")
          .not("youtube_playlist_id", "is", null)
          .eq("user_id", WORKSPACE_OWNER_ID);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results = [];
        for (const s of rows ?? []) {
          const playlistId = s.youtube_playlist_id?.trim();
          if (!playlistId) continue;
          try {
            const r = await syncWatchlistPlaylist(supabaseAdmin, s.user_id, playlistId);

            await supabaseAdmin
              .from("integration_settings")
              .update({ last_sync_at: new Date().toISOString(), last_sync_count: r.added })
              .eq("user_id", s.user_id);

            let telegram = null;
            if (r.addedIds.length) {
              try {
                telegram = await sendMaterialsNow(supabaseAdmin, s.user_id, r.addedIds);
              } catch (e) {
                telegram = { error: e instanceof Error ? e.message : String(e) };
              }
            }
            results.push({ ...r, telegram });
          } catch (e) {
            results.push({
              playlistId,
              apiReturned: 0,
              skippedDuplicates: 0,
              added: 0,
              addedIds: [],
              errors: [e instanceof Error ? e.message : String(e)],
            });
          }
        }
        return Response.json({ ok: true, results, ranAt: new Date().toISOString() });
      },
    },
  },
});
