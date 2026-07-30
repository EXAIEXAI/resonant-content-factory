import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/sync/youtube")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, x-webhook-secret",
          },
        }),
      POST: async ({ request }) => {
        const secret = request.headers.get("x-webhook-secret") ?? "";
        if (!secret) return Response.json({ error: "missing secret" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings, error } = await supabaseAdmin
          .from("integration_settings")
          .select("user_id, webhook_secret")
          .eq("webhook_secret", secret)
          .maybeSingle();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        if (!settings || !timingSafeEqual(settings.webhook_secret, secret)) {
          return Response.json({ error: "invalid secret" }, { status: 401 });
        }

        const { syncAllSourcesWith } = await import("@/lib/yt-sync.server");
        try {
          const result = await syncAllSourcesWith(supabaseAdmin, settings.user_id);
          await supabaseAdmin
            .from("integration_settings")
            .update({ last_sync_at: result.ranAt, last_sync_count: result.totalAdded })
            .eq("user_id", settings.user_id);
          return Response.json({ ok: true, ...result }, { headers: { "access-control-allow-origin": "*" } });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
