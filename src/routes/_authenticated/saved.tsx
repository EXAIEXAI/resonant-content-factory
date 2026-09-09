import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MaterialCard } from "@/components/MaterialCard";
import { computeScore } from "@/lib/scoring";
import { syncWatchlist } from "@/lib/youtube.functions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { MaterialFilters, useMaterialFilters, filterMaterials } from "@/components/MaterialFilters";

export const Route = createFileRoute("/_authenticated/saved")({
  head: () => ({
    meta: [
      { title: "Из плейлиста · Контент-завод" },
      { name: "description", content: "Ролики, сохранённые вручную в YouTube-плейлист «Контент-завод»." },
      { property: "og:title", content: "Из плейлиста · Контент-завод" },
      { property: "og:description", content: "Ролики, сохранённые вручную в YouTube-плейлист «Контент-завод»." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SavedPage,
});

function SavedPage() {
  const qc = useQueryClient();
  const sync = useServerFn(syncWatchlist);
  const [tag, setTag] = useState<string>("all");
  const { query, setQuery, range, setRange } = useMaterialFilters();

  const { data: materials } = useQuery({
    queryKey: ["materials-saved"],
    queryFn: async () =>
      (await supabase
        .from("raw_materials")
        .select("*")
        .eq("source_type", "youtube_saved")
        .order("created_at", { ascending: false })).data ?? [],
  });

  const tags = useMemo(() => {
    const s = new Set<string>();
    (materials ?? []).forEach(m => {
      if (m.playlist_label) s.add(m.playlist_label);
    });
    return Array.from(s).sort();
  }, [materials]);

  const list = useMemo(
    () =>
      filterMaterials(
        (materials ?? []).filter(m => tag === "all" || m.playlist_label === tag),
        query,
        range,
      ).map(m => {
        const { score, factors } = computeScore({ ...m, subscribers: 1000 });
        return { ...m, computedScore: score, factors };
      }),
    [materials, tag, query, range],
  );

  const pull = useMutation({
    mutationFn: async () => sync({ data: {} } as any),
    onSuccess: (r: any) => {
      toast.success(r?.added ? `Добавлено роликов: ${r.added}` : "Новых роликов нет");
      qc.invalidateQueries({ queryKey: ["materials-saved"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Из плейлиста</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Ролики, которые вы сохранили вручную в YouTube-плейлист — отдельно от лент отслеживаемых каналов
          </p>
        </div>
        <Button onClick={() => pull.mutate()} disabled={pull.isPending}>
          {pull.isPending ? "Забираю..." : "Забрать из плейлиста"}
        </Button>
      </div>

      <MaterialFilters query={query} setQuery={setQuery} range={range} setRange={setRange} />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={tag === "all" ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setTag("all")}
          >
            Все
          </Badge>
          {tags.map(t => (
            <Badge
              key={t}
              variant={tag === t ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setTag(t)}
            >
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {list.map(m => (
          <div key={m.id} className="space-y-1">
            {m.playlist_label && (
              <Badge variant="outline" className="text-xs">{m.playlist_label}</Badge>
            )}
            <MaterialCard m={m} />
          </div>
        ))}
        {list.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              Пока пусто. Укажите плейлист в разделе{" "}
              <Link to="/integrations" className="text-primary hover:underline">«Интеграции»</Link>{" "}
              и сохраняйте в него ролики на YouTube — они появятся здесь автоматически.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
