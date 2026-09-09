import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useMemo, useState } from "react";
import { MaterialFilters, useMaterialFilters } from "@/components/MaterialFilters";
import { Calendar, Pencil, Trash2, RefreshCw, ExternalLink, Eye, ThumbsUp, MessageSquare } from "lucide-react";
import { buildWeeklyDigest } from "@/lib/digests.functions";
import { formatTimecode as fmtTC } from "@/lib/youtube";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/digests")({
  head: () => ({ meta: [{ title: "Дайджесты · Контент-завод" }] }),
  component: DigestsPage,
});

type Digest = {
  id: string;
  title: string;
  category: string;
  material_ids: string[] | null;
  created_at: string;
};

function DigestsPage() {
  const qc = useQueryClient();
  const { data: digests } = useQuery({
    queryKey: ["digests"],
    queryFn: async () =>
      ((await supabase.from("digests").select("*").order("created_at", { ascending: false })).data ?? []) as Digest[],
  });

  const allIds = Array.from(new Set((digests ?? []).flatMap(d => d.material_ids ?? [])));
  const { data: materialsMap } = useQuery({
    queryKey: ["digest-materials", allIds.sort().join(",")],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("raw_materials")
        .select("id,title,url,external_id,summary,views,reactions,comments_count,engagement_score,channel_title,thumbnail_url,chapters")
        .in("id", allIds);
      const map: Record<string, any> = {};
      (data ?? []).forEach((m: any) => { map[m.id] = m; });
      return map;
    },
  });

  const { query, setQuery, range, setRange } = useMaterialFilters();
  const active = !!query.trim() || !!range?.from;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = range?.from ? new Date(range.from).setHours(0, 0, 0, 0) : null;
    const to = range?.to
      ? new Date(range.to).setHours(23, 59, 59, 999)
      : range?.from ? new Date(range.from).setHours(23, 59, 59, 999) : null;

    return (digests ?? [])
      .map(d => {
        const ids = (d.material_ids ?? []).filter(mid => {
          const m = materialsMap?.[mid];
          if (!q && !from && !to) return true;
          if (q) {
            const hay = [d.title, m?.title, m?.summary, m?.channel_title].filter(Boolean).join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
          }
          if (from || to) {
            const t = new Date(m?.published_at ?? m?.created_at ?? d.created_at).getTime();
            if (from && t < from) return false;
            if (to && t > to) return false;
          }
          return true;
        });
        return { d, ids };
      })
      .filter(({ d, ids }) => {
        if (!active) return true;
        if (ids.length > 0) return true;
        // Keep digests matched by their own title / creation date.
        const titleHit = q ? d.title.toLowerCase().includes(q) : true;
        const t = new Date(d.created_at).getTime();
        const dateHit = (!from || t >= from) && (!to || t <= to);
        return titleHit && dateHit && (d.material_ids?.length ?? 0) === 0;
      });
  }, [digests, materialsMap, query, range, active]);

  const [editing, setEditing] = useState<Digest | null>(null);
  const buildWeekly = useServerFn(buildWeeklyDigest);

  const build = useMutation({
    mutationFn: async () => buildWeekly(),
    onSuccess: (r: any) => {
      if (r?.created) toast.success(`Дайджест собран: ${r.count} материалов`);
      else toast.info("За последние 7 дней нет материалов");
      qc.invalidateQueries({ queryKey: ["digests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async (d: Digest) => {
      const { error } = await supabase.from("digests").update({
        title: d.title,
      }).eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Сохранено"); qc.invalidateQueries({ queryKey: ["digests"] }); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("digests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Дайджест удалён"); qc.invalidateQueries({ queryKey: ["digests"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Дайджесты</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Топ 20% материалов за последние 7 дней (минимум 3). Автоматически обновляется еженедельно.</p>
        </div>
        <Button onClick={() => build.mutate()} disabled={build.isPending} className="w-full sm:w-auto">
          <RefreshCw className={`w-4 h-4 mr-2 ${build.isPending ? "animate-spin" : ""}`} />
          Собрать за неделю
        </Button>
      </div>

      <div className="grid gap-4">
        {(digests ?? []).map(d => (
          <Card key={d.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="font-serif">{d.title}</CardTitle>
                <div className="flex gap-2 mt-2 flex-wrap items-center">
                  <Badge variant="outline">{(d.material_ids?.length ?? 0)} мат.</Badge>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-4 h-4" />Создан {new Date(d.created_at).toLocaleString("ru")}
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setEditing(d)} aria-label="Редактировать"><Pencil className="w-4 h-4" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Удалить"><Trash2 className="w-4 h-4" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Удалить дайджест?</AlertDialogTitle>
                      <AlertDialogDescription>«{d.title}» будет удалён без возможности восстановления.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove.mutate(d.id)}>Удалить</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            {(d.material_ids?.length ?? 0) > 0 && (
              <CardContent>
                <Accordion type="single" collapsible>
                  <AccordionItem value="materials" className="border-0">
                    <AccordionTrigger className="text-sm py-2">Показать материалы ({d.material_ids?.length})</AccordionTrigger>
                    <AccordionContent>
                      <ol className="space-y-3 mt-2">
                        {(d.material_ids ?? []).map((mid, idx) => {
                          const m = materialsMap?.[mid];
                          if (!m) return (
                            <li key={mid} className="text-sm text-muted-foreground">#{idx + 1} — материал недоступен</li>
                          );
                          const originalUrl = getOriginalUrl(m);
                          return (
                            <li key={mid}>
                              <Link
                                to="/materials/$id"
                                params={{ id: mid }}
                                className="border rounded-md p-3 flex gap-3 transition-colors hover:bg-accent/50 hover:border-primary/40 cursor-pointer"
                              >
                              <div className="text-xs text-muted-foreground font-mono pt-1 w-6 shrink-0">#{idx + 1}</div>
                              {m.thumbnail_url && (
                                <img src={m.thumbnail_url} alt="" className="w-24 h-14 object-cover rounded shrink-0" />
                              )}
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-sm">{m.title}</div>
                                  <Badge variant="outline" className="shrink-0">{Math.round((m.engagement_score ?? 0))}</Badge>
                                </div>
                                {m.channel_title && <div className="text-xs text-muted-foreground">{m.channel_title}</div>}
                                {m.summary && <p className="text-xs text-muted-foreground line-clamp-2">{m.summary}</p>}
                                {Array.isArray(m.chapters) && m.chapters.length > 0 && (
                                  <ul className="space-y-1 pt-1">
                                    {(m.chapters as any[]).map((ch, ci) => {
                                      const tc = fmtTC(ch.start);
                                      const ytUrl = m.external_id && /^[a-zA-Z0-9_-]{11}$/.test(m.external_id)
                                        ? `https://www.youtube.com/watch?v=${m.external_id}&t=${Math.floor(ch.start)}s`
                                        : null;
                                      return (
                                        <li key={ci} className="text-xs flex gap-2">
                                          {ytUrl ? (
                                            <span
                                              role="link"
                                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(ytUrl, "_blank", "noopener,noreferrer"); }}
                                              className="font-mono text-primary hover:underline shrink-0"
                                            >{tc}</span>
                                          ) : (
                                            <span className="font-mono text-muted-foreground shrink-0">{tc}</span>
                                          )}
                                          <span className="text-muted-foreground"><span className="text-foreground">{ch.title}</span>{ch.summary ? ` — ${ch.summary}` : ""}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{(m.views ?? 0).toLocaleString("ru")}</span>
                                  <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{(m.reactions ?? 0).toLocaleString("ru")}</span>
                                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{(m.comments_count ?? 0).toLocaleString("ru")}</span>
                                  {originalUrl && (
                                    <span
                                      role="link"
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(originalUrl, "_blank", "noopener,noreferrer"); }}
                                      className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                                    >
                                      <ExternalLink className="w-3 h-3" />Открыть оригинал
                                    </span>
                                  )}
                                </div>
                              </div>
                              </Link>
                            </li>
                          );
                        })}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            )}
          </Card>
        ))}
        {digests?.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">Соберите первый дайджест из накопленных материалов.</CardContent></Card>}
      </div>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-serif">Редактировать дайджест</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Название</Label><Input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={() => editing && update.mutate(editing)} disabled={update.isPending}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getOriginalUrl(m: { external_id?: string | null; url?: string | null }): string | null {
  if (m.external_id && /^[a-zA-Z0-9_-]{11}$/.test(m.external_id)) {
    return `https://www.youtube.com/watch?v=${m.external_id}`;
  }
  if (m.url && /^https?:\/\//i.test(m.url)) return m.url;
  return null;
}
