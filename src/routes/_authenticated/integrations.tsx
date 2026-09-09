import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, ExternalLink, ListVideo, Send, KeyRound } from "lucide-react";
import {
  syncAllSources,
  checkYoutubeApi,
  listRecentMaterials,
  syncWatchlist,
  getIntegrationSettings,
  saveIntegrationSettings,
  listPlaylists,
  addPlaylist,
  updatePlaylist,
  deletePlaylist,
} from "@/lib/youtube.functions";
import { checkDrive } from "@/lib/gdrive.functions";
import { getGoogleStatus, startGoogleConnect, disconnectGoogle } from "@/lib/google.functions";
import { saveTelegramChatId, sendTelegramDigestNow } from "@/lib/telegram.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";



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
  const [playlistLabel, setPlaylistLabel] = useState("");

  const loadPlaylists = useServerFn(listPlaylists);
  const addPl = useServerFn(addPlaylist);
  const updPl = useServerFn(updatePlaylist);
  const delPl = useServerFn(deletePlaylist);
  const { data: playlists } = useQuery({ queryKey: ["yt_playlists"], queryFn: () => loadPlaylists() });

  const addPlaylistM = useMutation({
    mutationFn: () => addPl({ data: { url: playlist.trim(), label: playlistLabel.trim() } }),
    onSuccess: () => {
      toast.success("Плейлист добавлен");
      addLog(`Плейлист добавлен: ${playlistLabel.trim()}`);
      setPlaylist("");
      setPlaylistLabel("");
      qc.invalidateQueries({ queryKey: ["yt_playlists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePlaylistM = useMutation({
    mutationFn: (v: { id: string; label?: string; active?: boolean }) => updPl({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["yt_playlists"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePlaylistM = useMutation({
    mutationFn: (id: string) => delPl({ data: { id } }),
    onSuccess: () => {
      toast.success("Плейлист удалён");
      qc.invalidateQueries({ queryKey: ["yt_playlists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [ytKey, setYtKey] = useState("");
  const [driveFolder, setDriveFolder] = useState("");
  useEffect(() => {
    setYtKey(settings?.youtube_api_key ?? "");
    setDriveFolder(settings?.drive_folder_id ?? "");
  }, [settings?.youtube_api_key, settings?.drive_folder_id]);

  const saveKeysM = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          youtube_api_key: ytKey.trim() || null,
          drive_folder_id: driveFolder.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Ключи сохранены");
      addLog("Ключи YouTube/Диска сохранены");
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const watchlistM = useMutation({
    mutationFn: () => runWatchlist(),
    onSuccess: r => {
      r.results.forEach(x =>
        addLog(`• ${x.label}: вернул API ${x.apiReturned}, дублей ${x.skippedDuplicates}, добавлено ${x.added}${x.errors.length ? `, ошибок ${x.errors.length}` : ""}`),
      );
      toast.success(`Из плейлистов добавлено: ${r.added}`);
      qc.invalidateQueries({ queryKey: ["recent_materials"] });
    },
    onError: (e: Error) => {
      addLog(`Плейлист: ошибка — ${e.message}`);
      toast.error(e.message);
    },
  });

  const saveChat = useServerFn(saveTelegramChatId);
  const sendTg = useServerFn(sendTelegramDigestNow);
  const [chatIds, setChatIds] = useState<string[]>([""]);
  useEffect(() => {
    const list = (settings?.telegram_chat_id ?? "")
      .split(/[,\s;]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    setChatIds(list.length ? list : [""]);
  }, [settings?.telegram_chat_id]);

  const saveChatM = useMutation({
    mutationFn: () =>
      saveChat({
        data: { chat_id: chatIds.map(c => c.trim()).filter(Boolean).join(",") || null },
      }),
    onSuccess: r => {
      const list = (r?.chat_id ?? "").split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
      setChatIds(list.length ? list : [""]);
      toast.success(`Получатели сохранены: ${list.length}`);
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

  const googleStatus = useServerFn(getGoogleStatus);
  const startConnect = useServerFn(startGoogleConnect);
  const disconnect = useServerFn(disconnectGoogle);
  const { data: google } = useQuery({ queryKey: ["google_status"], queryFn: () => googleStatus() });

  const ytConnected = Boolean(google?.youtube.connected);
  const driveConnected = Boolean(google?.drive.connected);
  const bothConnected = ytConnected && driveConnected;

  const connectM = useMutation({
    mutationFn: async (provider: "youtube" | "drive") =>
      await startConnect({ data: { origin: window.location.origin, provider } }),
    onSuccess: r => {
      window.location.href = r.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectM = useMutation({
    mutationFn: (provider: "youtube" | "drive") => disconnect({ data: { provider } }),
    onSuccess: r => {
      toast.success(r.provider === "youtube" ? "YouTube отключён" : "Google Диск отключён");
      qc.invalidateQueries({ queryKey: ["google_status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkBothM = useMutation({
    mutationFn: async () => {
      const [y, d] = await Promise.allSettled([ytCheck(), driveCheck()]);
      return { y, d };
    },
    onSuccess: ({ y, d }) => {
      const ytOk = y.status === "fulfilled" && y.value.ok;
      const drOk = d.status === "fulfilled" && d.value.ok;
      const ytErr = y.status === "fulfilled" ? y.value.error : y.reason?.message;
      const drErr = d.status === "fulfilled" ? d.value.error : d.reason?.message;
      addLog(ytOk ? "YouTube: подключение работает" : `YouTube: недоступен — ${ytErr}`);
      addLog(drOk ? "Google Диск: подключение работает" : `Google Диск: недоступен — ${drErr}`);
      if (ytOk && drOk) toast.success("Оба сервиса доступны");
      else toast.error(`Недоступно: ${[!ytOk && "YouTube", !drOk && "Google Диск"].filter(Boolean).join(", ")}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [bothFlow, setBothFlow] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setBothFlow(sessionStorage.getItem("google_connect_flow") === "both");
    const p = new URLSearchParams(window.location.search);
    const g = p.get("google");
    if (!g) return;
    const provider = p.get("provider");
    const label = provider === "youtube" ? "YouTube" : provider === "drive" ? "Google Диск" : "Google";
    if (g === "connected") {
      toast.success(`${label} подключён`);
      if (provider === "drive") {
        sessionStorage.removeItem("google_connect_flow");
        setBothFlow(false);
      }
    } else {
      toast.error(`${label}: ${p.get("message") ?? "ошибка подключения"}`);
    }
    qc.invalidateQueries({ queryKey: ["google_status"] });
    window.history.replaceState({}, "", window.location.pathname);
  }, [qc]);

  const startBoth = () => {
    sessionStorage.setItem("google_connect_flow", "both");
    setBothFlow(true);
    setDialogOpen(false);
    connectM.mutate(ytConnected ? "drive" : "youtube");
  };

  const startSingle = (provider: "youtube" | "drive") => {
    sessionStorage.removeItem("google_connect_flow");
    setBothFlow(false);
    connectM.mutate(provider);
  };

  const showStep2Banner = bothFlow && ytConnected && !driveConnected;
  const missingLabel = !ytConnected && !driveConnected
    ? "YouTube и Google Диска"
    : !ytConnected
      ? "YouTube"
      : !driveConnected
        ? "Google Диска"
        : null;

  const yt = ytM.data;
  const drive = driveM.data;

  const ServiceBlock = ({
    title,
    step,
    provider,
    connected,
    email,
    connectedAt,
    hint,
    missingHint,
    extra,
  }: {
    title: string;
    step: string;
    provider: "youtube" | "drive";
    connected: boolean;
    email: string | null;
    connectedAt: string | null;
    hint: string;
    missingHint: string;
    extra?: ReactNode;
  }) => (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{step}</span>
        {connected ? (
          <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> подключено</Badge>
        ) : (
          <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> не подключено</Badge>
        )}
      </div>
      {connected ? (
        <div className="text-sm text-muted-foreground space-y-1">
          <div>{email ?? "аккаунт Google"} · с {fmt(connectedAt)}</div>
          {extra}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{hint}</p>
          <p className="text-sm text-destructive">{missingHint}</p>
        </div>
      )}
      {connected && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => disconnectM.mutate(provider)}
            disabled={disconnectM.isPending}
          >
            Отключить
          </Button>
        </div>
      )}
    </div>
  );

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
          <CardTitle className="text-base">Подключение Google</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showStep2Banner && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Шаг 2 из 2: осталось подключить Google Диск</p>
                <p className="text-sm text-muted-foreground">
                  Без Диска материалы не будут сохраняться в вашу папку, а синхронизация не запустится.
                </p>
              </div>
              <Button className="gap-2" onClick={() => connectM.mutate("drive")} disabled={connectM.isPending}>
                <ExternalLink className="h-4 w-4" /> Подключить Диск
              </Button>
            </div>
          )}

          {!bothConnected && (
            <div className="space-y-3">
              <Button className="gap-2" onClick={() => setDialogOpen(true)} disabled={connectM.isPending}>
                <ExternalLink className="h-4 w-4" /> Подключить Google
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Нужен только один сервис?</span>
                {!ytConnected && (
                  <Button size="sm" variant="outline" onClick={() => startSingle("youtube")} disabled={connectM.isPending}>
                    Только YouTube
                  </Button>
                )}
                {!driveConnected && (
                  <Button size="sm" variant="outline" onClick={() => startSingle("drive")} disabled={connectM.isPending}>
                    Только Google Диск
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <ServiceBlock
              title="YouTube"
              step="Шаг 1 из 2 — YouTube"
              provider="youtube"
              connected={ytConnected}
              email={google?.youtube.email ?? null}
              connectedAt={google?.youtube.connectedAt ?? null}
              hint="Чтение ваших плейлистов, подписок и статистики роликов."
              missingHint="Не сможем получать ролики с каналов"
            />
            <ServiceBlock
              title="Google Диск"
              step="Шаг 2 из 2 — Google Диск"
              provider="drive"
              connected={driveConnected}
              email={google?.drive.email ?? null}
              connectedAt={google?.drive.connectedAt ?? null}
              hint="Сохранение расшифровок и данных роликов в папку «Контент-завод»."
              missingHint="Материалы не будут сохраняться в вашу папку"
              extra={
                <div>
                  Папка:{" "}
                  {google?.drive.folderUrl ? (
                    <a className="underline" href={google.drive.folderUrl} target="_blank" rel="noreferrer">
                      Контент-завод <ExternalLink className="inline h-3 w-3" />
                    </a>
                  ) : (
                    "создастся автоматически при первой синхронизации"
                  )}
                </div>
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => checkBothM.mutate()}
              disabled={checkBothM.isPending}
            >
              Проверить подключение
            </Button>
          </div>
          {!bothConnected && (
            <p className="text-xs text-muted-foreground">
              Нет подключения {missingLabel} — будут использованы ключи API из формы ниже.
            </p>
          )}
          {(yt || drive) && (
            <p className="text-xs text-muted-foreground break-words">
              {yt ? (yt.ok ? "YouTube: подключение работает. " : `YouTube: ${yt.error} `) : ""}
              {drive ? (drive.ok ? `Диск: папка «${drive.folderName}» доступна.` : `Диск: ${drive.error}`) : ""}
            </p>
          )}

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Потребуется два подтверждения</DialogTitle>
                <DialogDescription>
                  Google не позволяет запросить доступ к YouTube и Диску одним окном, поэтому подтверждений будет
                  два: сначала YouTube — чтобы система видела ролики ваших каналов, затем Google Диск — чтобы создать
                  рабочую папку и складывать в неё материалы. Пройдите оба шага: если остановиться после первого,
                  автоматическая синхронизация не заработает.
                </DialogDescription>
              </DialogHeader>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Шаг 1 из 2 — YouTube {ytConnected ? "· подключено" : ""}</div>
                <div>Шаг 2 из 2 — Google Диск {driveConnected ? "· подключено" : ""}</div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
                <Button onClick={startBoth} disabled={connectM.isPending}>Продолжить</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>



        </CardContent>

      </Card>


      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Ключи YouTube и Google Диска
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Если персональное подключение Google не выполнено, приложение работает по ключам: ключ YouTube Data API
            v3 и идентификатор папки Google Диска. Оставьте поля пустыми — будут использованы ключи проекта.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ytkey">Ключ YouTube Data API v3</Label>
              <Input
                id="ytkey"
                value={ytKey}
                onChange={e => setYtKey(e.target.value)}
                placeholder="AIza... (по умолчанию — ключ проекта)"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="drivefolder">Папка Google Диска (ID или ссылка)</Label>
              <Input
                id="drivefolder"
                value={driveFolder}
                onChange={e => setDriveFolder(e.target.value)}
                placeholder="1AbC... или https://drive.google.com/drive/folders/..."
                className="font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => saveKeysM.mutate()} disabled={saveKeysM.isPending}>
              Сохранить ключи
            </Button>
            <Button variant="outline" onClick={() => checkBothM.mutate()} disabled={checkBothM.isPending}>
              Проверить доступ
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListVideo className="h-4 w-4" /> Плейлисты YouTube
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">Как добавлять ролики без копирования ссылок</p>
            <p>1. Создайте на YouTube один или несколько плейлистов с доступом «Открытый» или «Доступ по ссылке».</p>
            <p>2. Под любым видео жмите «Сохранить» → выберите нужный плейлист.</p>
            <p>3. Добавьте плейлисты ниже и задайте каждому тег — он будет виден на карточке ролика.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="playlist">Ссылка на плейлист или его ID</Label>
              <Input
                id="playlist"
                value={playlist}
                onChange={e => setPlaylist(e.target.value)}
                placeholder="https://www.youtube.com/playlist?list=PL..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="playlist-label">Тег</Label>
              <Input
                id="playlist-label"
                value={playlistLabel}
                onChange={e => setPlaylistLabel(e.target.value)}
                placeholder="Например: Маркетинг"
              />
            </div>
            <Button
              onClick={() => addPlaylistM.mutate()}
              disabled={addPlaylistM.isPending || !playlist.trim() || !playlistLabel.trim()}
            >
              Добавить
            </Button>
          </div>

          <div className="space-y-2">
            {(playlists ?? []).map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <Badge variant={p.active ? "default" : "secondary"}>{p.label}</Badge>
                <span className="font-mono text-xs text-muted-foreground break-all">{p.playlist_id}</span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updatePlaylistM.mutate({ id: p.id, active: !p.active })}
                    disabled={updatePlaylistM.isPending}
                  >
                    {p.active ? "Выключить" : "Включить"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deletePlaylistM.mutate(p.id)}
                    disabled={deletePlaylistM.isPending}
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            ))}
            {!(playlists ?? []).length && (
              <p className="text-sm text-muted-foreground">Плейлисты пока не добавлены.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => watchlistM.mutate()}
              disabled={watchlistM.isPending || !(playlists ?? []).length}
            >
              <RefreshCw className={`h-4 w-4 ${watchlistM.isPending ? "animate-spin" : ""}`} />
              Забрать ролики из плейлистов
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
            <Label htmlFor="chatid-0">Получатели (Telegram chat ID)</Label>
            {chatIds.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  id={`chatid-${i}`}
                  value={c}
                  onChange={e =>
                    setChatIds(prev => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  placeholder="123456789"
                />
                {chatIds.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setChatIds(prev => prev.filter((_, j) => j !== i))}
                    aria-label="Удалить получателя"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setChatIds(prev => [...prev, ""])}
              >
                Добавить пользователя
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => saveChatM.mutate()} disabled={saveChatM.isPending}>
              Сохранить получателей
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
