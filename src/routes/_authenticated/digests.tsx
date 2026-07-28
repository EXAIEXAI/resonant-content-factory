import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Calendar } from "lucide-react";
import { pickTopParetoPerChannel } from "@/lib/scoring";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/digests")({
  head: () => ({ meta: [{ title: "Дайджесты · Контент-завод" }] }),
  component: DigestsPage,
});

function DigestsPage() {
  const qc = useQueryClient();
  const { data: digests } = useQuery({
    queryKey: ["digests"],
    queryFn: async () => (await supabase.from("digests").select("*").order("scheduled_at", { ascending: false, nullsFirst: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", category: "Кадры", scheduled_at: "" });

  const build = useMutation({
    mutationFn: async () => {
      const { data: mats } = await supabase.from("raw_materials").select("*").eq("category", form.category);
      const top = pickTopParetoPerChannel(mats ?? [], 3);
      const { data: manual } = await supabase.from("raw_materials").select("*").eq("category", form.category).eq("is_manual", true);
      const material_ids = [...top.map(t => t.id), ...(manual ?? []).map(m => m.id)];
      const { error } = await supabase.from("digests").insert({
        title: form.title || `Дайджест «${form.category}» — ${new Date().toLocaleDateString("ru")}`,
        category: form.category,
        scheduled_at: form.scheduled_at || null,
        status: form.scheduled_at ? "scheduled" : "draft",
        material_ids,
        content_json: { top: top.length, manual: (manual ?? []).length },
      });
      if (error) throw error;
      // mark materials as in_digest
      await supabase.from("raw_materials").update({ status: "in_digest" }).in("id", top.map(t => t.id));
    },
    onSuccess: () => { toast.success("Дайджест собран"); qc.invalidateQueries({ queryKey: ["digests"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">Дайджесты</h1>
          <p className="text-muted-foreground mt-1">Еженедельные подборки лучших материалов с гибким календарём</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Собрать дайджест</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-serif">Новый дайджест</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Название (опционально)</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>Рубрика</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Кадры","Аудит","РОП","Продажи","Общее"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Отправка (опционально)</Label><Input type="datetime-local" value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => build.mutate()} disabled={build.isPending}>Собрать</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {(digests ?? []).map(d => (
          <Card key={d.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="font-serif">{d.title}</CardTitle>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary">{d.category}</Badge>
                  <Badge variant={d.status === "sent" ? "default" : "outline"}>{d.status}</Badge>
                  <Badge variant="outline">{(d.material_ids?.length ?? 0)} мат.</Badge>
                </div>
              </div>
              {d.scheduled_at && (
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-4 h-4" />{new Date(d.scheduled_at).toLocaleString("ru")}
                </div>
              )}
            </CardHeader>
          </Card>
        ))}
        {digests?.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">Соберите первый дайджест по одной из рубрик.</CardContent></Card>}
      </div>
    </div>
  );
}
