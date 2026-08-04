import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, ExternalLink, ListVideo, Send } from "lucide-react";
import {
  syncAllSources,
  checkYoutubeApi,
  listRecentMaterials,
  syncWatchlist,
  getIntegrationSettings,
  saveIntegrationSettings,
} from "@/lib/youtube.functions";
import { checkDrive } from "@/lib/gdrive.functions";
import { saveTelegramChatId, sendTelegramDigestNow } from "@/lib/telegram.functions";


export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Интеграции · Контент-завод" },
      { name: "description", content: "Состояние подключений YouTube и Google Диска, синхронизация роликов." },
      { property: "og:title", content: "Интеграции · Контент-завод" },
      { property: "og:description", content: "Состояние подключений и синхронизация источников." },
    ],
  }),
  component: IntegrationsPage,
});

type SyncSummary = Awaited<ReturnType<typeof syncAllSources>>;

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";

function IntegrationsPage() {
  const qc = useQueryClient();
  const runSync = useServerFn(syncAllSources);
  const ytCheck = useServerFn(checkYoutubeApi);
  const driveCheck = useServerFn(checkDrive);
  const recent = useServerFn(listRecentMaterials);

  const [log, setLog] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary["results"] | null>(null);

  const addLog = (line: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString("ru-RU")} — ${line}`, ...prev].slice(0, 60));

  const { data: materials } = useQuery({ queryKey: ["recent_materials"], queryFn: () => recent() });

  const ytM = useMutation({
    mutationFn: () => ytCheck(),
    onSuccess: r => addLog(r.ok ? "YouTube Data API: подключение работает" : `YouTube Data API: ошибка — ${r.error}`),
    onError: (e: Error) => addLog(`YouTube Data API: ошибка — ${e.message}`),
  });

  const driveM = useMutation({
    mutationFn: () => driveCheck(),
    onSuccess: r =>
      addLog(
        r.ok
          ? `Google Диск (${r.auth}): папка «${r.folderName}» доступна`
          : `Google Диск (${r.auth}): ошибка — ${r.error}`,
      ),
    onError: (e: Error) => addLog(`Google Диск: ошибка — ${e.message}`),
  });

  const syncM = useMutation({
    mutationFn: (sinceDays?: number) => runSync({ data: sinceDays ? { sinceDays } : {} }),
    onSuccess: r => {
      setSummary(r.results);
      setLastRun(r.ranAt);
      addLog(`Синхронизация завершена: добавлено ${r.totalAdded} роликов из ${r.results.length} каналов`);
      r.results.forEach(x =>
        addLog(
          `• ${x.channel}: API вернул ${x.apiReturned}, по дате отсеяно ${x.skippedByDate}, уже полных дублей ${x.skippedDuplicates}, дозаполнено ${x.backfilled}, добавлено новых ${x.added}${x.errors.length ? `, ошибок ${x.errors.length}` : ""}`,
        ),
      );

      toast.success(`Добавлено роликов: ${r.totalAdded}`);
      qc.invalidateQueries({ queryKey: ["recent_materials"] });
    },
    onError: (e: Error) => {
      addLog(`Синхронизация не удалась: ${e.message}`);
      toast.error(e.message);
    },
  });

  const loadSettings = useServerFn(getIntegrationSettings);
  const saveSettings = useServerFn(saveIntegrationSettings);
  const runWatchlist = useServerFn(syncWatchlist);
  const { data: settings } = useQuery({ queryKey: ["integration_settings"], queryFn: () => loadSettings() });
  const [playlist, setPlaylist] = useState("");
  useEffect(() => {
    if (settings?.youtube_playlist_id) setPlaylist(settings.youtube_playlist_id);
  }, [settings?.youtube_playlist_id]);

  const savePlaylistM = useMutation({
    mutationFn: () => saveSettings({ data: { playlist_id: playlist.trim() || null } }),
    onSuccess: () => {
      toast.success("Плейлист сохранён");
      addLog(`Плейлист сохранён: ${playlist.trim() || "—"}`);
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const watchlistM = useMutation({
    mutationFn: () => runWatchlist(),
    onSuccess: r => {
      addLog(
        `Плейлист: вернул API ${r.apiReturned}, дублей ${r.skippedDuplicates}, добавлено ${r.added}${r.errors.length ? `, ошибок ${r.errors.length}` : ""}`,
      );
      toast.success(`Из плейлиста добавлено: ${r.added}`);
      qc.invalidateQueries({ queryKey: ["recent_materials"] });
    },
    onError: (e: Error) => {
      addLog(`Плейлист: ошибка — ${e.message}`);
      toast.error(e.message);
    },
  });

  const saveChat = useServerFn(saveTelegramChatId);
  const sendTg = useServerFn(sendTelegramDigestNow);
  const [chatId, setChatId] = useState("");
  useEffect(() => {
    if (settings?.telegram_chat_id) setChatId(settings.telegram_chat_id);
  }, [settings?.telegram_chat_id]);

  const saveChatM = useMutation({
    mutationFn: () => saveChat({ data: { chat_id: chatId.trim() || null } }),
    onSuccess: () => {
      toast.success("Telegram-чат сохранён");
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendTgM = useMutation({
    mutationFn: (days: number) => sendTg({ data: { days } }),
    onSuccess: r => {
      if (r.skipped) {
        addLog(`Telegram: ${r.skipped}`);
        toast.message(r.skipped);
      } else {
        addLog(`Telegram: отправлено роликов ${r.sent}`);
        toast.success(`Отправлено роликов: ${r.sent}`);
      }
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: Error) => {
      addLog(`Telegram: ошибка — ${e.message}`);
      toast.error(e.message);
    },
  });

  const yt = ytM.data;
  const drive = driveM.data;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Интеграции</h1>
        <p className="text-sm text-muted-foreground">
          Ролики собираются самим приложением: YouTube Data API → Google Диск → материалы.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Состояние подключений</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">YouTube Data API</span>
                {yt ? (
                  yt.ok ? (
                    <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> работает</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> ошибка</Badge>
                  )
                ) : (
                  <Badge variant="secondary">не проверено</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {yt ? (yt.ok ? "Ключ задан, проверочный запрос выполнен." : yt.error) : "Ключ хранится в секретах приложения."}
              </p>
              <Button size="sm" variant="outline" onClick={() => ytM.mutate()} disabled={ytM.isPending}>
                Проверить
              </Button>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Google Диск</span>
                {drive ? (
                  drive.ok ? (
                    <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> работает</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> ошибка</Badge>
                  )
                ) : (
                  <Badge variant="secondary">не проверено</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {drive
                  ? drive.ok
                    ? <>Папка: <a className="underline" href={drive.folderUrl ?? "#"} target="_blank" rel="noreferrer">{drive.folderName}</a></>
                    : drive.error
                  : "Авторизация — OAuth refresh token из секретов."}
              </p>
              <Button size="sm" variant="outline" onClick={() => driveM.mutate()} disabled={driveM.isPending}>
                Проверить
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListVideo className="h-4 w-4" /> Плейлист «Смотреть в контент-заводе»
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">Как добавлять ролики без копирования ссылок</p>
            <p>1. Создайте на YouTube плейлист (например, «Контент-завод») с доступом «Открытый» или «Доступ по ссылке».</p>
            <p>2. Под любым видео жмите «Сохранить» → выберите этот плейлист. На телефоне — «Поделиться» → «Сохранить в плейлист».</p>
            <p>3. Вставьте ссылку на плейлист ниже. Приложение само заберёт ролики (проверка каждый час и по кнопке).</p>
            <p className="text-xs">Личный список «Смотреть позже» YouTube закрыт для внешних приложений, поэтому используется обычный плейлист.</p>
          </div>
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="playlist">Ссылка на плейлист или его ID</Label>
            <Input
              id="playlist"
              value={playlist}
              onChange={e => setPlaylist(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=PL..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => savePlaylistM.mutate()} disabled={savePlaylistM.isPending}>
              Сохранить плейлист
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => watchlistM.mutate()}
              disabled={watchlistM.isPending || !settings?.youtube_playlist_id}
            >
              <RefreshCw className={`h-4 w-4 ${watchlistM.isPending ? "animate-spin" : ""}`} />
              Забрать ролики из плейлиста
            </Button>
            <span className="text-sm text-muted-foreground">
              Последняя проверка: {fmt(settings?.last_sync_at)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> Ежедневная сводка в Telegram
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">Каждый день в 08:00 по Москве</p>
            <p>Бот присылает список роликов, сохранённых в плейлист за вчера: заголовок, краткое описание и кнопки «Смотреть» и «Читать обзор».</p>
            <p>Чтобы узнать chat ID: напишите боту любое сообщение и вставьте сюда ваш ID (например, от @userinfobot).</p>
          </div>
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="chatid">Telegram chat ID</Label>
            <Input
              id="chatid"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => saveChatM.mutate()} disabled={saveChatM.isPending}>
              Сохранить чат
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => sendTgM.mutate(1)}
              disabled={sendTgM.isPending || !settings?.telegram_chat_id}
            >
              <Send className="h-4 w-4" /> Отправить за вчера
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => sendTgM.mutate(7)}
              disabled={sendTgM.isPending || !settings?.telegram_chat_id}
            >
              <Send className="h-4 w-4" /> Отправить за 7 дней
            </Button>
            <span className="text-sm text-muted-foreground">
              Последняя отправка: {fmt(settings?.telegram_last_sent_at)}
            </span>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle className="text-base">Синхронизация</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => syncM.mutate(undefined)} disabled={syncM.isPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${syncM.isPending ? "animate-spin" : ""}`} />
              Синхронизировать сейчас
            </Button>
            <Button
              variant="outline"
              onClick={() => syncM.mutate(30)}
              disabled={syncM.isPending}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncM.isPending ? "animate-spin" : ""}`} />
              Синхронизировать за 30 дней
            </Button>
            <span className="text-sm text-muted-foreground">Последний запуск: {fmt(lastRun)}</span>
          </div>

          {summary && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Канал</th>
                    <th className="p-2">Вернул API</th>
                    <th className="p-2">Отсеяно по дате</th>
                    <th className="p-2">Уже полные дубли</th>
                    <th className="p-2">Дозаполнено</th>
                    <th className="p-2">Добавлено новых</th>
                    <th className="p-2">Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(r => (
                    <tr key={r.channel} className="border-t align-top">
                      <td className="p-2">{r.channel}</td>
                      <td className="p-2">{r.apiReturned}</td>
                      <td className="p-2">{r.skippedByDate}</td>
                      <td className="p-2">{r.skippedDuplicates}</td>
                      <td className="p-2">{r.backfilled}</td>
                      <td className="p-2">{r.added}</td>
                      <td className="p-2 text-destructive text-xs">{r.errors.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>

              </table>
            </div>
          )}

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние загруженные ролики</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Название</th>
                  <th className="p-2">Канал</th>
                  <th className="p-2">Дата</th>
                  <th className="p-2">Просмотры</th>
                  <th className="p-2">Ссылки</th>
                </tr>
              </thead>
              <tbody>
                {(materials ?? []).map(m => (
                  <tr key={m.id} className="border-t">
                    <td className="p-2 max-w-[280px] truncate">{m.title}</td>
                    <td className="p-2">{m.channel_title ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{fmt(m.published_at ?? m.created_at)}</td>
                    <td className="p-2">{(m.views ?? 0).toLocaleString("ru-RU")}</td>
                    <td className="p-2">
                      <div className="flex gap-3">
                        {m.url && (
                          <a className="inline-flex items-center gap-1 underline" href={m.url} target="_blank" rel="noreferrer">
                            видео <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {m.drive_file_id && (
                          <a
                            className="inline-flex items-center gap-1 underline"
                            href={m.drive_file_url ?? `https://drive.google.com/file/d/${m.drive_file_id}/view`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            файл <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!(materials ?? []).length && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={5}>Пока нет роликов</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал операций</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
            {log.length ? log.join("\n") : "Журнал пуст"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
