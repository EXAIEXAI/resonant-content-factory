import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, ExternalLink } from "lucide-react";
import { syncAllSources, checkYoutubeApi, listRecentMaterials } from "@/lib/youtube.functions";
import { checkDrive } from "@/lib/gdrive.functions";

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
