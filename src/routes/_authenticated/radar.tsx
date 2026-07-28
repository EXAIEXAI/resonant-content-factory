import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState, useMemo } from "react";
import { Plus, Sparkles, ExternalLink } from "lucide-react";
import { computeScore, pickTopParetoPerChannel } from "@/lib/scoring";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({ meta: [{ title: "Отраслевой радар · Контент-завод" }] }),
  component: RadarPage,
});

function RadarPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>("all");

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

  const filtered = category === "all" ? enriched : enriched.filter(m => m.category === category);
  const auto = filtered.filter(m => !m.is_manual);
  const manual = filtered.filter(m => m.is_manual);
  const top = pickTopParetoPerChannel(
    auto.map(m => ({ ...m, engagement_score: m.computedScore })),
    3,
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", url: "", raw_transcript: "", category: "Кадры", channel_id: "", views: 0, reactions: 0, comments_count: 0,
  });

  const addManual = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        channel_id: form.channel_id || null,
        is_manual: true,
        status: "found" as const,
        engagement_score: computeScore(form).score,
      };
      const { error } = await supabase.from("raw_materials").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Материал добавлен в приоритетную очередь");
      qc.invalidateQueries({ queryKey: ["materials"] });
      setOpen(false);
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
              <DialogHeader><DialogTitle className="font-serif">Приоритетная очередь</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Заголовок</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                <div><Label>Ссылка</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></div>
                <div><Label>Рубрика</Label>
                  <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["Кадры","Аудит","РОП","Продажи","Общее"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Канал (опционально)</Label>
                  <Select value={form.channel_id} onValueChange={v => setForm({ ...form, channel_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{(channels ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Транскрипт / Текст</Label><Textarea rows={5} value={form.raw_transcript} onChange={e => setForm({ ...form, raw_transcript: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>Просмотры</Label><Input type="number" value={form.views} onChange={e => setForm({ ...form, views: +e.target.value })} /></div>
                  <div><Label>Реакции</Label><Input type="number" value={form.reactions} onChange={e => setForm({ ...form, reactions: +e.target.value })} /></div>
                  <div><Label>Комментарии</Label><Input type="number" value={form.comments_count} onChange={e => setForm({ ...form, comments_count: +e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={() => addManual.mutate()} disabled={addManual.isPending}>Добавить</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "Кадры", "Аудит", "РОП", "Продажи", "Общее"].map(c => (
          <Button key={c} size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
            {c === "all" ? "Все" : c}
          </Button>
        ))}
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
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary">{m.category}</Badge>
            {m.is_manual && <Badge variant="outline" className="border-accent text-accent-foreground bg-accent/20"><Sparkles className="w-3 h-3 mr-1" />Ручной</Badge>}
            {m.channel?.title && <span className="text-xs text-muted-foreground">· {m.channel.title}</span>}
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
      <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex gap-3">
          <span>Охват: {m.breakdown?.reach ?? "—"}</span>
          <span>Глубина: {m.breakdown?.depth ?? "—"}</span>
          <span>Темп: {m.breakdown?.velocity ?? "—"}</span>
          <span>Свежесть: {m.breakdown?.age ?? "—"}</span>
        </div>
        {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><ExternalLink className="w-3 h-3" />Оригинал</a>}
      </CardContent>
    </Card>
  );
}
