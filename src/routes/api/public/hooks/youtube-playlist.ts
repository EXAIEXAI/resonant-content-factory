// TODO: legacy GAS ingest — оставлен для совместимости, новый путь: /api/public/sync/youtube
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SegmentSchema = z.object({
  start: z.number().nonnegative(),
  dur: z.number().nonnegative().optional().default(0),
  text: z.string(),
});

const BodySchema = z.object({
  video_id: z.string().min(5).max(32),
  title: z.string().max(500),
  channel_title: z.string().max(300).optional().nullable(),
  url: z.string().url().max(1000).optional(),
  published_at: z.string().optional().nullable(),
  duration_seconds: z.number().int().nonnegative().optional().nullable(),
  thumbnail_url: z.string().url().max(1000).optional().nullable(),
  drive_file_id: z.string().max(200).optional().nullable(),
  drive_file_url: z.string().url().max(1000).optional().nullable(),
  transcript_text: z.string().optional().nullable(),
  transcript_segments: z.array(SegmentSchema).optional().default([]),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/hooks/youtube-playlist")({
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

        const raw = await request.text();
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(json);
        if (!parsed.success) {
          return Response.json({ error: "invalid body", details: parsed.error.issues }, { status: 400 });
        }
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: settings, error: sErr } = await supabaseAdmin
          .from("integration_settings")
          .select("user_id, webhook_secret")
          .eq("webhook_secret", secret)
          .maybeSingle();
        if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
        if (!settings || !timingSafeEqual(settings.webhook_secret, secret)) {
          return Response.json({ error: "invalid secret" }, { status: 401 });
        }

        const canonicalUrl = body.url ?? `https://www.youtube.com/watch?v=${body.video_id}`;
        const transcriptText = body.transcript_text ?? body.transcript_segments.map(s => s.text).join(" ");

        const { data: existing } = await supabaseAdmin
          .from("raw_materials")
          .select("id, source_type")
          .eq("user_id", settings.user_id)
          .eq("external_id", body.video_id)
          .maybeSingle();

        const upsertRow = {
          user_id: settings.user_id,
          external_id: body.video_id,
          title: body.title,
          channel_title: body.channel_title ?? null,
          url: canonicalUrl,
          thumbnail_url: body.thumbnail_url ?? null,
          duration_seconds: body.duration_seconds ?? null,
          drive_file_id: body.drive_file_id ?? null,
          drive_file_url: body.drive_file_url ?? null,
          transcript_segments: body.transcript_segments,
          raw_transcript: transcriptText || null,
          published_at: body.published_at ?? null,
          is_manual: true,
          source_type: "youtube_playlist",
          status: existing?.source_type ? undefined : "found",
          added_by: settings.user_id,
        };

        const { data: upserted, error: upErr } = await supabaseAdmin
          .from("raw_materials")
          .upsert(upsertRow, { onConflict: "user_id,external_id" })
          .select("id")
          .single();

        if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

        if (transcriptText) {
          const { analyzeMaterialById } = await import("@/lib/analyze.server");
          analyzeMaterialById(supabaseAdmin, upserted.id).catch(e => console.error("auto-analyze failed", e));
        }

        await supabaseAdmin
          .from("integration_settings")
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_count: (0),
          })
          .eq("user_id", settings.user_id);

        return Response.json(
          { ok: true, video_id: body.video_id, deduped: !!existing },
          { headers: { "access-control-allow-origin": "*" } },
        );
      },
    },
  },
});
