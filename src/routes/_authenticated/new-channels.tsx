import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { computeScore } from "@/lib/scoring";
import { MaterialCard } from "@/components/MaterialCard";
import { MaterialFilters, useMaterialFilters, filterMaterials } from "@/components/MaterialFilters";

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
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { query, setQuery, range, setRange } = useMaterialFilters();

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*")).data ?? [],
  });
  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () =>
      (await supabase.from("raw_materials").select("*").order("engagement_score", { ascending: false })).data ?? [],
  });
  const { data: positions } = useQuery({
    queryKey: ["all-positions"],
    queryFn: async () => (await supabase.from("expert_positions").select("material_id")).data ?? [],
  });
  const commentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions ?? []) map.set(p.material_id, (map.get(p.material_id) ?? 0) + 1);
    return map;
  }, [positions]);

  const promote = useMutation({
    mutationFn: async (id: string) => {
      setPendingId(id);
      const { error } = await supabase.from("raw_materials").update({ promoted_to_radar: true }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Видео отправлено в радар");
      qc.invalidateQueries({ queryKey: ["materials"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPendingId(null),
  });

  const { ranked, newChannels } = useMemo(() => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const fresh = (channels ?? []).filter(c => new Date(c.created_at).getTime() >= cutoff);
    const chMap = new Map(fresh.map(c => [c.id, c]));
    const list = (materials ?? [])
      .filter(m =>
        m.source_type !== "youtube_saved" &&
        !(m as any).promoted_to_radar &&
        m.channel_id && chMap.has(m.channel_id),
      )
      .map(m => {
        const ch = chMap.get(m.channel_id!);
        const { score, factors, breakdown } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
        return { ...m, computedScore: score, factors, breakdown, channel: ch, subscribers: ch?.subscribers ?? 1000, commentCount: commentCounts.get(m.id) ?? 0 };
      })
      .sort((a, b) => b.computedScore - a.computedScore);
    return {
      ranked: filterMaterials(list.map((m, i) => ({ ...m, rank: i + 1, total: list.length })), query, range),
      newChannels: fresh,
    };
  }, [channels, materials, commentCounts, query, range]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Новые каналы</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Ролики с источников, подключённых за последние три месяца
          {newChannels.length > 0 ? ` · каналов: ${newChannels.length}` : ""}
        </p>
      </div>

      <MaterialFilters query={query} setQuery={setQuery} range={range} setRange={setRange} />

      <div className="space-y-3">
        {ranked.map(m => (
          <MaterialCard
            key={m.id}
            m={m}
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={pendingId === m.id}
                onClick={() => promote.mutate(m.id)}
              >
                <Send className="w-3 h-3 mr-1" />
                {pendingId === m.id ? "Отправляю..." : "Отправить в радар"}
              </Button>
            }
          />
        ))}
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
