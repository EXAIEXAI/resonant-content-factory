import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listChannelUploads, checkNewUploads } from "@/lib/youtube.functions";
import { uploadTextFile, syncPendingVideosToDrive, ensureFolder } from "@/lib/gdrive.functions";

export const Route = createFileRoute("/_authenticated/integrations-test")({
  head: () => ({
    meta: [
      { title: "Тест интеграций · Контент-завод" },
      { name: "description", content: "Ручная проверка интеграций YouTube и Диска: последние ролики канала, новые загрузки и выгрузка метаданных." },
      { property: "og:title", content: "Тест интеграций · Контент-завод" },
      { property: "og:description", content: "Ручная проверка интеграций YouTube и Диска в «Контент-заводе»." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsTestPage,
});

type Upload = { videoId: string; title: string; publishedAt: string | null; thumbnail: string | null; url: string };

function IntegrationsTestPage() {
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [videos, setVideos] = useState<Upload[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);

  const uploads = useServerFn(listChannelUploads);
  const checkNew = useServerFn(checkNewUploads);
  const driveUpload = useServerFn(uploadTextFile);
  const driveSync = useServerFn(syncPendingVideosToDrive);
  const driveEnsureFolder = useServerFn(ensureFolder);

  const push = (line: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString("ru-RU")} — ${line}`, ...prev].slice(0, 100));

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    push(`▶ ${name}`);
    try {
      await fn();
    } catch (e: unknown) {
      push(`✕ Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Тест интеграций</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Ручной запуск серверных функций YouTube и Диска. Автоматики нет — только кнопки.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Канал YouTube</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channelId">ID канала (UC…) или @handle</Label>
            <Input
              id="channelId"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!!busy || !channelId.trim()}
              onClick={() =>
                run("Последние видео", async () => {
                  const res = await uploads({ data: { channelId, maxResults: 10 } });
                  setVideos(res.items);
                  push(`✓ Получено роликов: ${res.items.length}`);
                })
              }
            >
              Последние видео
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy || !channelId.trim()}
              onClick={() =>
                run("Проверить новые", async () => {
                  const res = await checkNew({ data: { channelId, maxResults: 10 } });
                  setVideos(res.newItems);
                  push(`✓ Проверено: ${res.checked}, новых сохранено: ${res.newItems.length}`);
                })
              }
            >
              Проверить новые
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                run("Папка Диска", async () => {
                  const res = await driveEnsureFolder({ data: {} as never });
                  setFolderId(res.id);
                  push(`✓ Папка «${res.name}» ${res.created ? "создана" : "найдена"}: ${res.id}`);
                })
              }
            >
              Папка Диска
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                run("Тест Диска", async () => {
                  const name = `test-${Date.now()}.txt`;
                  const res = await driveUpload({
                    data: { name, content: `Проверка загрузки из Контент-завода: ${new Date().toISOString()}` },
                  });
                  push(`✓ Файл ${name} создан: ${res.webViewLink ?? res.id}`);
                })
              }
            >
              Тест Диска
            </Button>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                run("Синк в Диск", async () => {
                  const res = await driveSync({ data: {} as never });
                  push(`✓ Обработано записей: ${res.total}`);
                  res.results.forEach(r =>
                    push(r.ok ? `  • ${r.videoId} → ${r.webViewLink ?? r.driveFileId}` : `  • ${r.videoId} ✕ ${r.error}`),
                  );
                })
              }
            >
              Синк в Диск
            </Button>
          </div>
          {folderId && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="text-muted-foreground">
                Id рабочей папки Диска — сохраните его в секрет GDRIVE_FOLDER_ID:
              </p>
              <code className="font-mono break-all">{folderId}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {videos.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map(v => (
            <Card key={v.videoId} className="overflow-hidden">
              {v.thumbnail && (
                <img src={v.thumbnail} alt={`Обложка ролика «${v.title}»`} className="w-full aspect-video object-cover" loading="lazy" />
              )}
              <CardContent className="p-4 space-y-2">
                <p className="font-medium leading-snug line-clamp-2">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {v.publishedAt ? new Date(v.publishedAt).toLocaleString("ru-RU") : "дата неизвестна"}
                </p>
                <a href={v.url} target="_top" rel="noreferrer" className="text-sm text-primary underline break-all">
                  Открыть оригинал
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока пусто — нажмите любую кнопку.</p>
          ) : (
            <pre className="text-xs whitespace-pre-wrap break-words max-h-80 overflow-auto">{log.join("\n")}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
