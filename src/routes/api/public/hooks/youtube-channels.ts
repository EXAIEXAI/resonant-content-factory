import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function resolveOwner(secret: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("integration_settings")
    .select("user_id, webhook_secret")
    .eq("webhook_secret", secret)
    .maybeSingle();
  if (!data || !timingSafeEqual(data.webhook_secret, secret)) return null;
  return { userId: data.user_id, supabaseAdmin };
}

const UpdateBody = z.object({
  id: z.string().uuid(),
  external_id: z.string().min(3).max(64).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  subscribers: z.number().int().nonnegative().nullable().optional(),
  mark_polled: z.boolean().optional(),
});

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-webhook-secret",
};

export const Route = createFileRoute("/api/public/hooks/youtube-channels")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),

      // GAS reads the list of YouTube channels to poll.
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
        if (!secret) return Response.json({ error: "missing secret" }, { status: 401, headers: cors });
        const owner = await resolveOwner(secret);
        if (!owner) return Response.json({ error: "invalid secret" }, { status: 401, headers: cors });

        const { data, error } = await owner.supabaseAdmin
          .from("channels")
          .select("id, url, external_id, title, last_polled_at")
          .eq("platform", "youtube")
          .eq("active", true)
          .order("created_at", { ascending: true });
        if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });

        return Response.json({ channels: data ?? [] }, { headers: cors });
      },

      // GAS updates resolved channel_id / stats after polling.
      POST: async ({ request }) => {
        const secret = request.headers.get("x-webhook-secret") ?? "";
        if (!secret) return Response.json({ error: "missing secret" }, { status: 401, headers: cors });
        const owner = await resolveOwner(secret);
        if (!owner) return Response.json({ error: "invalid secret" }, { status: 401, headers: cors });

        const raw = await request.text();
        let json: unknown;
        try { json = JSON.parse(raw); } catch {
          return Response.json({ error: "invalid json" }, { status: 400, headers: cors });
        }
        const parsed = UpdateBody.safeParse(json);
        if (!parsed.success) {
          return Response.json({ error: "invalid body", details: parsed.error.issues }, { status: 400, headers: cors });
        }
        const b = parsed.data;
        const patch: {
          external_id?: string | null;
          title?: string;
          subscribers?: number;
          last_polled_at?: string;
        } = {};
        if (b.external_id !== undefined) patch.external_id = b.external_id;
        if (b.title) patch.title = b.title;
        if (b.subscribers !== undefined && b.subscribers !== null) patch.subscribers = b.subscribers;
        if (b.mark_polled) patch.last_polled_at = new Date().toISOString();

        const { error } = await owner.supabaseAdmin
          .from("channels")
          .update(patch)
          .eq("id", b.id);
        if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });
        return Response.json({ ok: true }, { headers: cors });

      },
    },
  },
});
