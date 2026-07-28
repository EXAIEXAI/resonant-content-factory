import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2, Youtube, Send, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "Источники · Контент-завод" }] }),
  component: ChannelsPage,
});

function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("t.me") || u.includes("telegram")) return "telegram";
  return "other";
}

function deriveTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    return path ? `${u.hostname}/${path}` : u.hostname;
  } catch {
    return url;
  }
}

function ChannelsPage() {
  const qc = useQueryClient();
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Укажите ссылку");
      const { error } = await supabase.from("channels").insert({
        platform: detectPlatform(trimmed),
        url: trimmed,
        title: deriveTitle(trimmed),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Источник добавлен");
      qc.invalidateQueries({ queryKey: ["channels"] });
      setOpen(false);
      setUrl("");
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
            <div className="space-y-3">
              <div>
                <Label>Ссылка</Label>
                <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtube.com/@channel или https://t.me/channel" autoFocus />
              </div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Сохранить</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {(channels ?? []).map(c => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                  {c.platform === "youtube" ? <Youtube className="w-4 h-4" /> : c.platform === "telegram" ? <Send className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{c.title}</CardTitle>
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
            Добавьте первую ссылку на YouTube или Telegram-канал.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
