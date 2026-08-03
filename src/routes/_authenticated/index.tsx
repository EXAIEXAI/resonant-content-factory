import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Rss, FileStack, Sparkles } from "lucide-react";
import { statusLabels } from "@/lib/ui-labels";
import { computeScore } from "@/lib/scoring";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Дашборд · Контент-завод" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [c, m, d, o] = await Promise.all([
        supabase.from("channels").select("id", { count: "exact", head: true }),
        supabase.from("raw_materials").select("id, status", { count: "exact" }),
        supabase.from("digests").select("id", { count: "exact", head: true }),
        supabase.from("content_outputs").select("id, status", { count: "exact" }),
      ]);
      const byStatus = (m.data ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});
      return {
        channels: c.count ?? 0,
        materials: m.count ?? 0,
        digests: d.count ?? 0,
        outputs: o.count ?? 0,
        byStatus,
      };
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent-materials"],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, title, engagement_score, status, created_at, views, reactions, comments_count, published_at, channel_id")
        .order("created_at", { ascending: false })
        .limit(6);
      const { data: chans } = await supabase.from("channels").select("id, subscribers");
      const subs = new Map((chans ?? []).map(c => [c.id, c.subscribers ?? 1000]));
      return (data ?? []).map(r => ({
        ...r,
        liveScore: computeScore({ ...r, subscribers: r.channel_id ? subs.get(r.channel_id) ?? 1000 : 1000 }).score,
      }));
    },
  });


  const cards = [
    { label: "Источников", value: stats?.channels ?? 0, icon: Radio, to: "/channels" },
    { label: "Материалов", value: stats?.materials ?? 0, icon: Rss, to: "/radar" },
    { label: "Дайджестов", value: stats?.digests ?? 0, icon: FileStack, to: "/digests" },
    { label: "Публикаций", value: stats?.outputs ?? 0, icon: Sparkles, to: "/kanban" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Дашборд</h1>
        <p className="text-muted-foreground mt-1">Общая картина по вашему контент-заводу</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <Link key={c.label} to={c.to}>
            <Card className="hover:border-primary/40 transition-colors">
              <CardContent className="pt-6">
                <c.icon className="w-5 h-5 text-muted-foreground" />
                <div className="mt-3 text-3xl font-serif">{c.value}</div>
                <div className="text-sm text-muted-foreground">{c.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="font-serif">Свежие материалы</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(recent ?? []).length === 0 && <p className="text-sm text-muted-foreground">Пока пусто. Добавьте источники и запустите сбор.</p>}
            {recent?.map(r => (
              <Link key={r.id} to="/materials/$id" params={{ id: r.id }} className="block p-3 rounded-md border hover:border-primary/40 transition-colors">
                <div className="text-sm font-medium line-clamp-1">{r.title}</div>
              <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                <span>Рейтинг {r.liveScore ?? Math.round(r.engagement_score ?? 0)}</span>
                <span>· {statusLabels[r.status ?? ""] ?? r.status ?? "—"}</span>
              </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-serif">Воронка производства</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                ["found", "Найдено (Радар)"],
                ["in_digest", "В дайджесте"],
                ["awaiting_expert", "Ожидает эксперта"],
                ["in_production", "В производстве"],
                ["review", "Согласование"],
                ["ready", "Готово к публикации"],
                ["published", "Опубликовано"],
              ].map(([k, label]) => {
                const count = stats?.byStatus?.[k] ?? 0;
                const total = stats?.materials ?? 1;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{label}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-2 rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min((count / total) * 100, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
