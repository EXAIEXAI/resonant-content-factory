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
import { Plus, Trash2, Youtube, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "Источники · Контент-завод" }] }),
  component: ChannelsPage,
});

function ChannelsPage() {
  const qc = useQueryClient();
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ platform: "youtube", url: "", title: "", category: "Кадры", subscribers: 0 });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("channels").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Источник добавлен");
      qc.invalidateQueries({ queryKey: ["channels"] });
      setOpen(false);
      setForm({ platform: "youtube", url: "", title: "", category: "Кадры", subscribers: 0 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["channels"] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">Источники</h1>
          <p className="text-muted-foreground mt-1">YouTube-каналы и Telegram-каналы для мониторинга</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Добавить источник</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-serif">Новый источник</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Платформа</Label>
                <Select value={form.platform} onValueChange={v => setForm({ ...form, platform: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="telegram">Telegram</SelectItem>
                    <SelectItem value="other">Другое</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Название</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>URL</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></div>
              <div><Label>Рубрика</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Кадры", "Аудит", "РОП", "Продажи", "Общее"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Подписчики</Label><Input type="number" value={form.subscribers} onChange={e => setForm({ ...form, subscribers: +e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Сохранить</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {(channels ?? []).map(c => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded bg-muted flex items-center justify-center">
                  {c.platform === "youtube" ? <Youtube className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                </div>
                <div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="secondary">{c.category}</Badge>
                    <Badge variant="outline">{(c.subscribers ?? 0).toLocaleString("ru")} подп.</Badge>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}><Trash2 className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary line-clamp-1">{c.url}</a>
            </CardContent>
          </Card>
        ))}
        {channels?.length === 0 && (
          <Card className="md:col-span-2"><CardContent className="py-12 text-center text-muted-foreground">
            Добавьте первый YouTube или Telegram канал, чтобы начать мониторинг.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
