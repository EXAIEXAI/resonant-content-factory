import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2, Youtube, Send, Link as LinkIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncChannel, syncAllChannels } from "@/lib/channels.functions";

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
  const syncFn = useServerFn(syncChannel);
  const syncAllFn = useServerFn(syncAllChannels);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Укажите ссылку");
      const platform = detectPlatform(trimmed);
      const { data: inserted, error } = await supabase.from("channels").insert({
        platform,
        url: trimmed,
        title: deriveTitle(trimmed),
      }).select().single();
      if (error) throw error;
      if (platform === "youtube") {
        try {
          const r = await syncFn({ data: { channelId: inserted.id } });
          return { added: r.added, message: r.message };
        } catch (e) {
          console.error(e);
          return { added: 0, message: "Канал добавлен, но не удалось подтянуть ролики" };
        }
      }
      return { added: 0, message: null };
    },
    onSuccess: (r) => {
      if (r?.message) toast.warning(r.message);
      else toast.success(`Источник добавлен${r?.added ? `, подтянуто роликов: ${r.added}` : ""}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
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

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const r = await syncFn({ data: { channelId: id } });
      if (r.message) toast.warning(r.message);
      else toast.success(`Обновлено. Новых роликов: ${r.added} из ${r.total}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) {
      toast.error(e.message ?? "Ошибка синхронизации");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncAll() {
    toast.info("Синхронизирую все каналы…");
    try {
      const r = await syncAllFn({});
      toast.success(`Готово. Каналов: ${r.channels}, новых роликов: ${r.added}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) {
      toast.error(e.message ?? "Ошибка");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Источники</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">YouTube-каналы и Telegram-каналы для мониторинга</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleSyncAll}><RefreshCw className="w-4 h-4 mr-2" /> Обновить все</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Добавить источник</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-serif">Новый источник</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Ссылка</Label>
                  <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtube.com/@channel или https://t.me/channel" autoFocus />
                  <p className="text-xs text-muted-foreground mt-2">Для YouTube автоматически подтянутся последние 15 роликов из RSS канала.</p>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                  Здесь добавляются ссылки на <span className="font-medium text-foreground">каналы</span>. Ссылки на одиночные видео добавляйте во вкладке <Link to="/radar" className="text-primary hover:underline">«Отраслевой радар»</Link>.
                </div>
              </div>
              <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? "Загружаю…" : "Сохранить"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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
                  {(c as any).last_polled_at && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Обновлено: {new Date((c as any).last_polled_at).toLocaleString("ru-RU")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {c.platform === "youtube" && (
                  <Button variant="ghost" size="icon" onClick={() => handleSync(c.id)} disabled={syncingId === c.id} title="Обновить">
                    <RefreshCw className={`w-4 h-4 ${syncingId === c.id ? "animate-spin" : ""}`} />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
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
