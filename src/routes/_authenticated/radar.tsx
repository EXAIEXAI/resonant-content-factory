import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import { computeScore } from "@/lib/scoring";
import { MaterialCard } from "@/components/MaterialCard";
import { ingestUrl, refreshAllMaterials } from "@/lib/youtube.functions";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({ meta: [{ title: "Отраслевой радар · Контент-завод" }] }),
  component: RadarPage,
});

function RadarPage() {
  const qc = useQueryClient();
  const ingest = useServerFn(ingestUrl);
  const refreshAll = useServerFn(refreshAllMaterials);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*")).data ?? [],
  });
  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => (await supabase.from("raw_materials").select("*").order("engagement_score", { ascending: false })).data ?? [],
  });

  const ranked = useMemo(() => {
    const chMap = new Map((channels ?? []).map(c => [c.id, c]));
    const list = (materials ?? [])
      .map(m => {
        const ch = m.channel_id ? chMap.get(m.channel_id) : null;
        const { score, factors, breakdown } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
        return { ...m, computedScore: score, factors, breakdown, channel: ch, subscribers: ch?.subscribers ?? 1000 };
      })
      .sort((a, b) => b.computedScore - a.computedScore);
    return list.map((m, i) => ({ ...m, rank: i + 1, total: list.length }));
  }, [channels, materials]);

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const addManual = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Укажите ссылку");
      return ingest({ data: { url: trimmed } });
    },
    onSuccess: (r) => {
      toast.success(
        r.source_type === "youtube_manual"
          ? r.hasTranscript
            ? "YouTube-ролик добавлен с транскриптом"
            : "YouTube-ролик добавлен (субтитры недоступны)"
          : "Материал добавлен",
      );
      qc.invalidateQueries({ queryKey: ["materials"] });
      setOpen(false);
      setUrl("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recompute = useMutation({
    mutationFn: async () => {
      // 1) Refresh real YouTube stats + analyze anything without a summary.
      const r = await refreshAll();
      // 2) Recompute scores from the latest numbers.
      const { data: fresh } = await supabase.from("raw_materials").select("*");
      const chMap = new Map((channels ?? []).map(c => [c.id, c]));
      await Promise.all((fresh ?? []).map(m => {
        const ch = m.channel_id ? chMap.get(m.channel_id) : null;
        const { score } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
        return supabase.from("raw_materials").update({ engagement_score: score }).eq("id", m.id);
      }));
      return r;
    },
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.statsUpdated) parts.push(`статистика: ${r.statsUpdated}`);
      if (r.analyzed) parts.push(`проанализировано: ${r.analyzed}`);
      if (!r.apiKeyUsed) parts.push("без API-ключа YouTube — цифры приблизительные");
      toast.success(parts.length ? `Готово · ${parts.join(" · ")}` : "Рейтинги пересчитаны");
      qc.invalidateQueries({ queryKey: ["materials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Отраслевой радар</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Все материалы с ваших каналов, ранжированные по формуле резонанса</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => recompute.mutate()}>Пересчитать</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Ручной материал</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="font-serif">Добавить материал</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Ссылка</Label>
                  <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtu.be/... или любой URL" autoFocus />
                  <p className="text-xs text-muted-foreground mt-1">Для YouTube автоматически подтянутся название, автор и субтитры.</p>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Здесь добавляются ссылки на <span className="font-medium text-foreground">одиночные видео</span>. Ссылки на каналы добавляйте во вкладке <Link to="/channels" className="text-primary hover:underline">«Источники»</Link>.
                </div>
              </div>
              <DialogFooter><Button onClick={() => addManual.mutate()} disabled={addManual.isPending}>{addManual.isPending ? "Загружаю..." : "Добавить"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-3">
        {ranked.map(m => <MaterialCard key={m.id} m={m} />)}
        {ranked.length === 0 && <EmptyRadar />}
      </div>
    </div>
  );
}

function EmptyRadar() {
  return <Card><CardContent className="py-12 text-center text-muted-foreground">Пока пусто. Добавьте материал вручную или подключите источники.</CardContent></Card>;
}

