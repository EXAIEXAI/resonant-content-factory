// Ежедневная (08:00 МСК) отправка вчерашних сохранённых роликов в Telegram.
import { createFileRoute } from "@tanstack/react-router";
import { WORKSPACE_OWNER_ID } from "@/lib/workspace";

export const Route = createFileRoute("/api/public/hooks/telegram-digest")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendSavedDigest } = await import("@/lib/telegram.server");

        const { data: rows, error } = await supabaseAdmin
          .from("integration_settings")
          .select("user_id, telegram_chat_id")
          .not("telegram_chat_id", "is", null)
          .eq("user_id", WORKSPACE_OWNER_ID);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results = [];
        for (const s of rows ?? []) {
          try {
            results.push(await sendSavedDigest(supabaseAdmin, s.user_id));
          } catch (e) {
            results.push({
              chatId: s.telegram_chat_id,
              materials: 0,
              sent: 0,
              skipped: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return Response.json({ ok: true, results, ranAt: new Date().toISOString() });
      },
    },
  },
});
