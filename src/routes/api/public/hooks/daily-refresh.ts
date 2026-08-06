import { createFileRoute } from "@tanstack/react-router";

// Вызывается pg_cron каждый день в 08:00 (Europe/Moscow).
// Проходит по всем пользователям с подключённым Google и синхронизирует их каналы
// от их имени (персональный OAuth), затем анализирует материалы без резюме.
export const Route = createFileRoute("/api/public/hooks/daily-refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncAllSourcesWith } = await import("@/lib/yt-sync.server");
        const { analyzeMaterialById } = await import("@/lib/analyze.server");
        const db = supabaseAdmin as any;

        const { data: connections } = await db.from("google_connections").select("user_id");

        const perUser: Array<{ userId: string; added: number; error?: string }> = [];
        for (const c of connections ?? []) {
          try {
            const r = await syncAllSourcesWith(supabaseAdmin as never, c.user_id, null);
            perUser.push({ userId: c.user_id, added: r.totalAdded });
          } catch (e) {
            perUser.push({ userId: c.user_id, added: 0, error: e instanceof Error ? e.message : String(e) });
          }
        }

        // Анализируем всё, у чего ещё нет резюме.
        const { data: materials } = await db.from("raw_materials").select("id, summary").is("summary", null);
        let analyzed = 0;
        for (const m of materials ?? []) {
          try {
            await analyzeMaterialById(supabaseAdmin as never, m.id);
            analyzed += 1;
          } catch (e) {
            console.error("daily-refresh analyze failed", m.id, e);
          }
        }

        // Формируем развёрнутые разборы для сохранённых роликов без разбора.
        const { generateReviewById } = await import("@/lib/review.server");
        const { data: needReview } = await db
          .from("raw_materials")
          .select("id")
          .is("review_md", null)
          .order("created_at", { ascending: false })
          .limit(40);
        let reviewed = 0;
        for (const m of needReview ?? []) {
          try {
            await generateReviewById(supabaseAdmin as never, m.id);
            reviewed += 1;
          } catch (e) {
            console.error("daily-refresh review failed", m.id, e);
          }
        }

        return Response.json({ ok: true, users: perUser, analyzed, reviewed, at: new Date().toISOString() });

      },
    },
  },
});
