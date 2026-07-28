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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useMemo } from "react";
import { Plus, Sparkles, ExternalLink, Crown, FileText, ChevronDown, Eye, ThumbsUp, MessageSquare } from "lucide-react";
import { computeScore, type ScoreFactor } from "@/lib/scoring";
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">Отраслевой радар</h1>
          <p className="text-muted-foreground mt-1">Все материалы с ваших каналов, ранжированные по формуле резонанса</p>
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

function formatRaw(key: ScoreFactor["key"], raw: number): string {
  switch (key) {
    case "views": return raw.toLocaleString("ru-RU");
    case "reach": return `${(raw * 100).toFixed(1)}% подписчиков`;
    case "engagement": return `${(raw * 100).toFixed(2)}% от просмотров`;
    case "velocity": return `${raw.toFixed(1)} просм/час`;
    case "recency": return `${raw.toFixed(1)} дн. назад`;
  }
}

function MaterialCard({ m }: { m: any }) {
  const fromPlaylist = m.source_type === "youtube_playlist";
  const [open, setOpen] = useState(false);
  const factors: ScoreFactor[] = m.factors ?? [];
  const topFactor = factors.slice().sort((a, b) => b.contribution - a.contribution)[0];
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="secondary">#{m.rank}</Badge>
            {fromPlaylist && <Badge className="bg-primary text-primary-foreground"><Crown className="w-3 h-3 mr-1" />Из плейлиста</Badge>}
            {m.is_manual && !fromPlaylist && <Badge variant="outline" className="border-accent text-accent-foreground bg-accent/20"><Sparkles className="w-3 h-3 mr-1" />Ручной</Badge>}
            {m.channel_title && <span className="text-xs text-muted-foreground">· {m.channel_title}</span>}
            {!m.channel_title && m.channel?.title && <span className="text-xs text-muted-foreground">· {m.channel.title}</span>}
          </div>
          <CardTitle className="text-base leading-snug">
            <Link to="/materials/$id" params={{ id: m.id }} className="hover:text-primary">{m.title}</Link>
          </CardTitle>
          {m.summary && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed line-clamp-3">{m.summary}</p>
          )}
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl text-primary">{Math.round(m.computedScore ?? m.engagement_score ?? 0)}<span className="text-sm text-muted-foreground">/100</span></div>
          <div className="text-xs text-muted-foreground">Рейтинг</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
          <div className="flex gap-4 flex-wrap text-muted-foreground">
            <span className="flex items-center gap-1"><Eye className="w-4 h-4" />{(m.views ?? 0).toLocaleString("ru-RU")}</span>
            <span className="flex items-center gap-1"><ThumbsUp className="w-4 h-4" />{(m.reactions ?? 0).toLocaleString("ru-RU")}</span>
            <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4" />{(m.comments_count ?? 0).toLocaleString("ru-RU")}</span>
          </div>
          <div className="flex items-center gap-2">
            {m.drive_file_url && (
              <a
                href={m.drive_file_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(m.drive_file_url, "_blank", "noopener,noreferrer"); }}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border hover:bg-accent hover:text-accent-foreground"
              >
                <FileText className="w-3 h-3" />Google Диск
              </a>
            )}
            {m.url && (
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(m.url, "_blank", "noopener,noreferrer"); }}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" />Открыть оригинал
              </a>
            )}
          </div>
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-primary hover:underline">
              <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Скрыть объяснение рейтинга" : "Почему такая позиция?"}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="text-xs text-muted-foreground">
                Позиция <span className="font-medium text-foreground">#{m.rank}</span> из {m.total}.
                {topFactor && <> Наибольший вклад — <span className="font-medium text-foreground">{topFactor.label.toLowerCase()}</span> (+{Math.round(topFactor.contribution * 100)} баллов).</>}
              </div>
              <div className="space-y-2">
                {factors.map(f => (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-medium">{f.label}</span>
                        <span className="text-muted-foreground"> · вес {(f.weight * 100).toFixed(0)}% · {formatRaw(f.key, f.raw)}</span>
                      </div>
                      <span className="font-mono">+{Math.round(f.contribution * 100)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.round(f.normalized * 100)}%` }} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">{f.description}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Итоговый рейтинг</span>
                <span className="font-serif text-lg text-primary">{Math.round(m.computedScore ?? 0)} / 100</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
