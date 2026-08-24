import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { useMemo } from "react";
import { computeScore } from "@/lib/scoring";
import { MaterialCard } from "@/components/MaterialCard";

export const Route = createFileRoute("/_authenticated/new-channels")({
  head: () => ({
    meta: [
      { title: "Новые каналы · Контент-завод" },
      { name: "description", content: "Ролики с каналов, добавленных за последние три месяца." },
      { property: "og:title", content: "Новые каналы · Контент-завод" },
      { property: "og:description", content: "Ролики с каналов, добавленных за последние три месяца." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewChannelsPage,
});

function NewChannelsPage() {
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*")).data ?? [],
  });
  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () =>
      (await supabase.from("raw_materials").select("*").order("engagement_score", { ascending: false })).data ?? [],
  });

  const { ranked, newChannels } = useMemo(() => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const fresh = (channels ?? []).filter(c => new Date(c.created_at).getTime() >= cutoff);
    const chMap = new Map(fresh.map(c => [c.id, c]));
    const list = (materials ?? [])
      .filter(m => m.source_type !== "youtube_saved" && m.channel_id && chMap.has(m.channel_id))
      .map(m => {
        const ch = chMap.get(m.channel_id!);
        const { score, factors, breakdown } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
        return { ...m, computedScore: score, factors, breakdown, channel: ch, subscribers: ch?.subscribers ?? 1000 };
      })
      .sort((a, b) => b.computedScore - a.computedScore);
    return {
      ranked: list.map((m, i) => ({ ...m, rank: i + 1, total: list.length })),
      newChannels: fresh,
    };
  }, [channels, materials]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Новые каналы</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Ролики с источников, подключённых за последние три месяца
          {newChannels.length > 0 ? ` · каналов: ${newChannels.length}` : ""}
        </p>
      </div>

      <div className="space-y-3">
        {ranked.map(m => <MaterialCard key={m.id} m={m} />)}
        {ranked.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              За последние три месяца новых каналов с материалами нет.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
