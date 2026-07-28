import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/weekly-digest")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildWeeklyDigestFor } = await import("@/lib/digests.functions");
        try {
          const result = await buildWeeklyDigestFor(supabaseAdmin, null);
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
        }
      },
    },
  },
});
