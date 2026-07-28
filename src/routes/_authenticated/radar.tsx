import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import { Plus, Sparkles, ExternalLink, Crown, FileText } from "lucide-react";
import { computeScore, pickTopParetoPerChannel } from "@/lib/scoring";
import { ingestUrl } from "@/lib/youtube.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({ meta: [{ title: "Отраслевой радар · Контент-завод" }] }),
  component: RadarPage,
});

function RadarPage() {
  const qc = useQueryClient();
  const ingest = useServerFn(ingestUrl);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*")).data ?? [],
  });
  const { data: materials } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => (await supabase.from("raw_materials").select("*").order("engagement_score", { ascending: false })).data ?? [],
  });

  const enriched = useMemo(() => {
    const chMap = new Map((channels ?? []).map(c => [c.id, c]));
    return (materials ?? []).map(m => {
      const ch = m.channel_id ? chMap.get(m.channel_id) : null;
      const { score, breakdown } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
      return { ...m, computedScore: score, breakdown, channel: ch };
    });
  }, [channels, materials]);

  const filtered = enriched;
  const auto = filtered.filter(m => !m.is_manual);
  const manual = filtered.filter(m => m.is_manual);
  const top = pickTopParetoPerChannel(
    auto.map(m => ({ ...m, engagement_score: m.computedScore })),
    3,
  );

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
      const chMap = new Map((channels ?? []).map(c => [c.id, c]));
      const updates = (materials ?? []).map(m => {
        const ch = m.channel_id ? chMap.get(m.channel_id) : null;
        const { score } = computeScore({ ...m, subscribers: ch?.subscribers ?? 1000 });
        return supabase.from("raw_materials").update({ engagement_score: score }).eq("id", m.id);
      });
      await Promise.all(updates);
    },
    onSuccess: () => { toast.success("Рейтинги пересчитаны"); qc.invalidateQueries({ queryKey: ["materials"] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">Отраслевой радар</h1>
          <p className="text-muted-foreground mt-1">Топ-20% материалов по формуле резонанса, минимум 3 на канал</p>
        </div>
        <div className="flex gap-2">
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
              </div>
              <DialogFooter><Button onClick={() => addManual.mutate()} disabled={addManual.isPending}>{addManual.isPending ? "Загружаю..." : "Добавить"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>


      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top">Топ (20% по Парето) · {top.length}</TabsTrigger>
          <TabsTrigger value="manual">Ручные (вне конкурса) · {manual.length}</TabsTrigger>
          <TabsTrigger value="all">Все · {filtered.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="top" className="space-y-3 mt-4">
          {top.map(m => <MaterialCard key={m.id} m={m} />)}
          {top.length === 0 && <EmptyRadar />}
        </TabsContent>
        <TabsContent value="manual" className="space-y-3 mt-4">
          {manual.map(m => <MaterialCard key={m.id} m={m} />)}
          {manual.length === 0 && <EmptyRadar />}
        </TabsContent>
        <TabsContent value="all" className="space-y-3 mt-4">
          {filtered.map(m => <MaterialCard key={m.id} m={m} />)}
          {filtered.length === 0 && <EmptyRadar />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyRadar() {
  return <Card><CardContent className="py-12 text-center text-muted-foreground">Пока пусто. Добавьте материал вручную или подключите источники.</CardContent></Card>;
}

function MaterialCard({ m }: { m: any }) {
  const isChef = m.source_type === "youtube_playlist";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isChef && <Badge className="bg-primary text-primary-foreground"><Crown className="w-3 h-3 mr-1" />Выбор Шефа</Badge>}
            {m.is_manual && !isChef && <Badge variant="outline" className="border-accent text-accent-foreground bg-accent/20"><Sparkles className="w-3 h-3 mr-1" />Ручной</Badge>}
            {m.channel_title && <span className="text-xs text-muted-foreground">· {m.channel_title}</span>}
            {!m.channel_title && m.channel?.title && <span className="text-xs text-muted-foreground">· {m.channel.title}</span>}
          </div>
          <CardTitle className="text-base leading-snug">
            <Link to="/materials/$id" params={{ id: m.id }} className="hover:text-primary">{m.title}</Link>
          </CardTitle>
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl text-primary">{(m.computedScore ?? m.engagement_score ?? 0).toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">Score</div>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between text-xs text-muted-foreground gap-3 flex-wrap">
        <div className="flex gap-3 flex-wrap">
          <span>Охват: {m.breakdown?.reach ?? "—"}</span>
          <span>Глубина: {m.breakdown?.depth ?? "—"}</span>
          <span>Темп: {m.breakdown?.velocity ?? "—"}</span>
          <span>Свежесть: {m.breakdown?.age ?? "—"}</span>
        </div>
        <div className="flex items-center gap-3">
          {m.drive_file_url && <a href={m.drive_file_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><FileText className="w-3 h-3" />Google Диск</a>}
          {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><ExternalLink className="w-3 h-3" />Оригинал</a>}
        </div>
      </CardContent>
    </Card>
  );
}
