import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useState } from "react";
import { Calendar, Pencil, Trash2, RefreshCw, ExternalLink, Eye, ThumbsUp, MessageSquare } from "lucide-react";
import { buildWeeklyDigest } from "@/lib/digests.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/digests")({
  head: () => ({ meta: [{ title: "Дайджесты · Контент-завод" }] }),
  component: DigestsPage,
});


const STATUSES = ["draft", "scheduled", "sent", "archived"] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  sent: "Отправлен",
  archived: "Архив",
};

type Digest = {
  id: string;
  title: string;
  category: string;
  status: string;
  scheduled_at: string | null;
  material_ids: string[] | null;
};

function DigestsPage() {
  const qc = useQueryClient();
  const { data: digests } = useQuery({
    queryKey: ["digests"],
    queryFn: async () =>
      ((await supabase.from("digests").select("*").order("scheduled_at", { ascending: false, nullsFirst: false })).data ?? []) as Digest[],
  });

  const allIds = Array.from(new Set((digests ?? []).flatMap(d => d.material_ids ?? [])));
  const { data: materialsMap } = useQuery({
    queryKey: ["digest-materials", allIds.sort().join(",")],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("raw_materials")
        .select("id,title,url,summary,views,reactions,comments_count,engagement_score,channel_title,thumbnail_url")
        .in("id", allIds);
      const map: Record<string, any> = {};
      (data ?? []).forEach((m: any) => { map[m.id] = m; });
      return map;
    },
  });

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
        status: d.status,
        scheduled_at: d.scheduled_at || null,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">Дайджесты</h1>
          <p className="text-muted-foreground mt-1">Топ 20% материалов за последние 7 дней (минимум 3). Автоматически обновляется еженедельно.</p>
        </div>
        <Button onClick={() => build.mutate()} disabled={build.isPending}>
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
                <div className="flex gap-2 mt-2 flex-wrap">
                  
                  <Badge variant={d.status === "sent" ? "default" : "outline"}>{STATUS_LABELS[d.status] ?? d.status}</Badge>
                  <Badge variant="outline">{(d.material_ids?.length ?? 0)} мат.</Badge>
                  {d.scheduled_at && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-4 h-4" />{new Date(d.scheduled_at).toLocaleString("ru")}
                    </span>
                  )}
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
              <div><Label>Статус</Label>
                <Select value={editing.status} onValueChange={v => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Отправка</Label>
                <Input type="datetime-local"
                  value={editing.scheduled_at ? new Date(editing.scheduled_at).toISOString().slice(0, 16) : ""}
                  onChange={e => setEditing({ ...editing, scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </div>
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
