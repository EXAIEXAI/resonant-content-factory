import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2, Youtube, Send, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncChannel, syncAllChannels } from "@/lib/channels.functions";
import { syncTelegramChannel, syncAllTelegramChannels } from "@/lib/tg-sources.functions";
import { WORKSPACE_OWNER_ID } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({
    meta: [
      { title: "Источники · Контент-завод" },
      { name: "description", content: "YouTube- и Telegram-каналы, за которыми следит контент-завод." },
      { property: "og:title", content: "Источники · Контент-завод" },
      { property: "og:description", content: "YouTube- и Telegram-каналы, за которыми следит контент-завод." },
    ],
  }),
  component: ChannelsPage,
});

function deriveTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    return path ? `${u.hostname}/${path}` : u.hostname;
  } catch {
    return url;
  }
}

function tgHandle(input: string): string | null {
  const raw = input.trim();
  if (raw.startsWith("@")) return raw.slice(1).replace(/[^a-zA-Z0-9_]/g, "") || null;
  const m = raw.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{3,})/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_]{3,}$/.test(raw)) return raw;
  return null;
}

type Channel = {
  id: string;
  platform: string;
  url: string;
  title: string;
  last_polled_at?: string | null;
};

function ChannelsPage() {
  const qc = useQueryClient();
  const syncYt = useServerFn(syncChannel);
  const syncAllYt = useServerFn(syncAllChannels);
  const syncTg = useServerFn(syncTelegramChannel);
  const syncAllTg = useServerFn(syncAllTelegramChannels);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () =>
      ((await supabase.from("channels").select("*").order("created_at", { ascending: false })).data ?? []) as Channel[],
  });

  const youtube = (channels ?? []).filter(c => c.platform === "youtube");
  const telegram = (channels ?? []).filter(c => c.platform === "telegram");

  const [openPlatform, setOpenPlatform] = useState<"youtube" | "telegram" | null>(null);
  const [url, setUrl] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (platform: "youtube" | "telegram") => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Укажите ссылку");

      if (platform === "telegram") {
        const handle = tgHandle(trimmed);
        if (!handle) throw new Error("Не похоже на Telegram-канал. Пример: https://t.me/channel или @channel");
        const { data: inserted, error } = await supabase.from("channels").insert({
          user_id: WORKSPACE_OWNER_ID,
          platform: "telegram",
          url: `https://t.me/${handle}`,
          title: `@${handle}`,
          external_id: handle,
        }).select().single();
        if (error) throw error;
        try {
          const r = await syncTg({ data: { channelId: inserted.id } });
          return { added: r.added, message: r.message ?? null };
        } catch {
          return { added: 0, message: "Канал добавлен, но посты подтянуть не удалось" };
        }
      }

      if (!/youtube\.com|youtu\.be/i.test(trimmed)) throw new Error("Укажите ссылку на YouTube-канал");
      const { data: inserted, error } = await supabase.from("channels").insert({
        user_id: WORKSPACE_OWNER_ID,
        platform: "youtube",
        url: trimmed,
        title: deriveTitle(trimmed),
      }).select().single();
      if (error) throw error;
      try {
        const r = await syncYt({ data: { channelId: inserted.id } });
        return { added: r.added, message: r.message ?? null };
      } catch {
        return { added: 0, message: "Канал добавлен, но не удалось подтянуть ролики" };
      }
    },
    onSuccess: (r) => {
      if (r?.message) toast.warning(r.message);
      else toast.success(`Источник добавлен${r?.added ? `, материалов подтянуто: ${r.added}` : ""}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      setOpenPlatform(null);
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

  async function handleSync(c: Channel) {
    setSyncingId(c.id);
    try {
      const r = c.platform === "telegram"
        ? await syncTg({ data: { channelId: c.id } })
        : await syncYt({ data: { channelId: c.id } });
      if (r.message) toast.warning(r.message);
      else toast.success(`Обновлено. Новых материалов: ${r.added} из ${r.total}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) {
      toast.error(e.message ?? "Ошибка синхронизации");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncAll(platform: "youtube" | "telegram") {
    toast.info("Синхронизирую…");
    try {
      const r = platform === "telegram" ? await syncAllTg({}) : await syncAllYt({});
      toast.success(`Готово. Каналов: ${r.channels}, новых материалов: ${r.added}`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (e: any) {
      toast.error(e.message ?? "Ошибка");
    }
  }

  const renderList = (list: Channel[], platform: "youtube" | "telegram") => (
    <div className="grid md:grid-cols-2 gap-4 mt-4">
      {list.map(c => (
        <Card key={c.id}>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                {platform === "youtube" ? <Youtube className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base truncate">{c.title}</CardTitle>
                {c.last_polled_at && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Обновлено: {new Date(c.last_polled_at).toLocaleString("ru-RU")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => handleSync(c)} disabled={syncingId === c.id} title="Обновить">
                <RefreshCw className={`w-4 h-4 ${syncingId === c.id ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary line-clamp-1">{c.url}</a>
          </CardContent>
        </Card>
      ))}
      {list.length === 0 && (
        <Card className="md:col-span-2"><CardContent className="py-12 text-center text-muted-foreground">
          {platform === "youtube" ? "Пока нет YouTube-каналов." : "Пока нет Telegram-каналов."}
        </CardContent></Card>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Источники</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">YouTube-каналы и Telegram-каналы ведутся отдельно</p>
      </div>

      <Tabs defaultValue="youtube">
        <TabsList>
          <TabsTrigger value="youtube"><Youtube className="w-4 h-4 mr-2" />YouTube ({youtube.length})</TabsTrigger>
          <TabsTrigger value="telegram"><Send className="w-4 h-4 mr-2" />Telegram ({telegram.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="youtube">
          <div className="flex gap-2 flex-wrap mt-4">
            <Button onClick={() => { setUrl(""); setOpenPlatform("youtube"); }}><Plus className="w-4 h-4 mr-2" />Добавить YouTube-канал</Button>
            <Button variant="outline" onClick={() => handleSyncAll("youtube")}><RefreshCw className="w-4 h-4 mr-2" />Обновить все</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Ссылки на одиночные видео добавляйте во вкладке <Link to="/radar" className="text-primary hover:underline">«Отраслевой радар»</Link>.
          </p>
          {renderList(youtube, "youtube")}
        </TabsContent>

        <TabsContent value="telegram">
          <div className="flex gap-2 flex-wrap mt-4">
            <Button onClick={() => { setUrl(""); setOpenPlatform("telegram"); }}><Plus className="w-4 h-4 mr-2" />Добавить Telegram-канал</Button>
            <Button variant="outline" onClick={() => handleSyncAll("telegram")}><RefreshCw className="w-4 h-4 mr-2" />Обновить все</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Подтягиваются последние посты публичного канала. Закрытые каналы недоступны.
          </p>
          {renderList(telegram, "telegram")}
        </TabsContent>
      </Tabs>

      <Dialog open={openPlatform !== null} onOpenChange={o => !o && setOpenPlatform(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">
              {openPlatform === "telegram" ? "Новый Telegram-канал" : "Новый YouTube-канал"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Ссылка</Label>
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={openPlatform === "telegram" ? "https://t.me/channel или @channel" : "https://youtube.com/@channel"}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-2">
                {openPlatform === "telegram"
                  ? "Подтянутся последние посты канала из публичного превью."
                  : "Автоматически подтянутся последние 15 роликов из RSS канала."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => openPlatform && create.mutate(openPlatform)} disabled={create.isPending}>
              {create.isPending ? "Загружаю…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
