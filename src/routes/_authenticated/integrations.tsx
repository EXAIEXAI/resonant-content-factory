import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, RefreshCcw, Play } from "lucide-react";
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  rotateWebhookSecret,
} from "@/lib/youtube.functions";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Интеграции · Контент-завод" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const qc = useQueryClient();
  const load = useServerFn(getIntegrationSettings);
  const save = useServerFn(saveIntegrationSettings);
  const rotate = useServerFn(rotateWebhookSecret);

  const { data: settings } = useQuery({ queryKey: ["integration_settings"], queryFn: () => load() });

  const [playlist, setPlaylist] = useState("");
  const [folder, setFolder] = useState("");

  useEffect(() => {
    if (settings) {
      setPlaylist(settings.youtube_playlist_id ?? "");
      setFolder(settings.drive_folder_id ?? "");
    }
  }, [settings]);

  const saveM = useMutation({
    mutationFn: () => save({ data: { playlist_id: playlist, drive_folder_id: folder } }),
    onSuccess: () => {
      toast.success("Настройки сохранены");
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotateM = useMutation({
    mutationFn: () => rotate(),
    onSuccess: () => {
      toast.success("Секрет обновлён");
      qc.invalidateQueries({ queryKey: ["integration_settings"] });
    },
  });

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/public/hooks/youtube-playlist` : "";
  const secret = settings?.webhook_secret ?? "";

  const gasCode = useMemo(
    () => buildGasScript({ playlistId: playlist || "PLAYLIST_ID", folderId: folder || "DRIVE_FOLDER_ID", webhookUrl, secret: secret || "WEBHOOK_SECRET" }),
    [playlist, folder, webhookUrl, secret],
  );

  const copy = async (text: string, label = "Скопировано") => {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-serif text-4xl">Интеграции</h1>
        <p className="text-muted-foreground mt-1">
          Автоматический сбор роликов из плейлиста YouTube через ваш Google-аккаунт (Google Apps Script).
          Скрипт запускается по расписанию, читает плейлист через YouTube Data API v3, сохраняет метаданные
          в папку Google Диска и отправляет их в приложение. API-ключи с нашей стороны не требуются.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">1. Что понадобится</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc ml-5 space-y-1">
            <li>Google-аккаунт с доступом к нужному плейлисту и папке на Диске.</li>
            <li>ID плейлиста YouTube (часть URL после <code>list=</code>).</li>
            <li>ID папки Google Диска (часть URL после <code>/folders/</code>), куда GAS будет складывать JSON-файлы роликов.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif">2. Настройки</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Плейлист YouTube (ID или ссылка)</Label>
            <Input value={playlist} onChange={e => setPlaylist(e.target.value)} placeholder="https://www.youtube.com/playlist?list=PLxxxx" />
          </div>
          <div>
            <Label>Папка на Google Диске (ID)</Label>
            <Input value={folder} onChange={e => setFolder(e.target.value)} placeholder="1AbCdEf... — из URL папки" />
          </div>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>Сохранить</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif">3. Вебхук приложения</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>URL (метод POST)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(webhookUrl)}><Copy className="w-4 h-4" /></Button>
            </div>
          </div>
          <div>
            <Label>Секрет (заголовок <code>x-webhook-secret</code>)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={secret} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(secret)}><Copy className="w-4 h-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => rotateM.mutate()} disabled={rotateM.isPending} title="Сгенерировать новый"><RefreshCcw className="w-4 h-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Секрет проверяется на сервере при каждом POST. При ротации обновите константу в GAS-скрипте.</p>
          </div>
          <div className="text-xs text-muted-foreground">
            Последняя синхронизация: {settings?.last_sync_at ? new Date(settings.last_sync_at).toLocaleString("ru-RU") : "ещё не было"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-serif">4. Скрипт Google Apps Script</CardTitle>
            <Button variant="outline" size="sm" onClick={() => copy(gasCode, "Код скопирован")}><Copy className="w-4 h-4 mr-2" />Копировать</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="text-sm space-y-1 list-decimal ml-5">
            <li>Откройте <a className="underline" href="https://script.google.com/home/my" target="_blank" rel="noreferrer">script.google.com</a> → «Новый проект».</li>
            <li>Вставьте код ниже, сохраните проект.</li>
            <li>Слева «Службы» (Services) → добавьте <b>YouTube Data API v3</b>.</li>
            <li>Запустите функцию <code>sync()</code> вручную один раз и подтвердите доступ к YouTube и Google Диску.</li>
            <li>Слева «Триггеры» → «По времени» → <code>sync</code>, каждые 15 минут.</li>
          </ol>
          <Textarea readOnly value={gasCode} rows={20} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">
            Скрипт передаёт метаданные ролика (название, канал, длительность, дата, обложка) и ссылку на файл в Google Диске.
            Субтитры отправляются только если они публично доступны у ролика; иначе материал появится без транскрипта — это нормально.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


function buildGasScript(o: { playlistId: string; folderId: string; webhookUrl: string; secret: string }): string {
  return `// Content-Factory · автосбор YouTube-плейлиста
const PLAYLIST_ID = '${o.playlistId}';
const DRIVE_FOLDER_ID = '${o.folderId}';
const WEBHOOK_URL = '${o.webhookUrl}';
const WEBHOOK_SECRET = '${o.secret}';

function sync() {
  const props = PropertiesService.getScriptProperties();
  const processed = JSON.parse(props.getProperty('processed') || '{}');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  let pageToken = null, added = 0;
  do {
    const res = YouTube.PlaylistItems.list('snippet,contentDetails', {
      playlistId: PLAYLIST_ID, maxResults: 50, pageToken,
    });
    for (const it of (res.items || [])) {
      const vid = it.contentDetails.videoId;
      if (processed[vid]) continue;
      try {
        const meta = fetchMeta(vid);
        const segments = fetchCaptions(vid);
        const payload = {
          video_id: vid,
          title: meta.title,
          channel_title: meta.channel,
          url: 'https://www.youtube.com/watch?v=' + vid,
          published_at: meta.publishedAt,
          duration_seconds: meta.durationSec,
          thumbnail_url: meta.thumb,
          transcript_segments: segments,
          transcript_text: segments.map(function(s){ return s.text; }).join(' '),
        };
        const file = folder.createFile('[YT] ' + safeName(meta.title) + '_' + vid + '.json',
          JSON.stringify(payload, null, 2), 'application/json');
        payload.drive_file_id = file.getId();
        payload.drive_file_url = file.getUrl();

        const resp = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: 'post', contentType: 'application/json',
          headers: { 'x-webhook-secret': WEBHOOK_SECRET },
          payload: JSON.stringify(payload), muteHttpExceptions: true,
        });
        if (resp.getResponseCode() < 300) {
          processed[vid] = Date.now();
          added++;
        } else {
          Logger.log('Webhook error ' + resp.getResponseCode() + ': ' + resp.getContentText());
        }
      } catch (e) { Logger.log('Video ' + vid + ' failed: ' + e); }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
  props.setProperty('processed', JSON.stringify(processed));
  Logger.log('Added: ' + added);
}

function fetchMeta(vid) {
  const v = YouTube.Videos.list('snippet,contentDetails', { id: vid }).items[0];
  return {
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    thumb: (v.snippet.thumbnails.high || v.snippet.thumbnails.default || {}).url,
    durationSec: isoDur(v.contentDetails.duration),
  };
}

function isoDur(iso) {
  const m = iso.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
}

function fetchCaptions(vid) {
  for (const lang of ['ru','en']) {
    try {
      const r = UrlFetchApp.fetch('https://video.google.com/timedtext?lang=' + lang + '&v=' + vid,
        { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) continue;
      const xml = r.getContentText();
      if (!xml) continue;
      const segs = [];
      const re = /<text[^>]*start="([\\d.]+)"[^>]*(?:dur="([\\d.]+)")?[^>]*>([\\s\\S]*?)<\\/text>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const text = decode(m[3]);
        if (text) segs.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]||'0'), text: text });
      }
      if (segs.length) return segs;
    } catch (e) {}
  }
  return [];
}

function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&#(\\d+);/g, function(_,n){ return String.fromCharCode(parseInt(n,10)); })
    .replace(/<[^>]+>/g,'').trim();
}

function safeName(s) { return String(s).replace(/[\\\\/:*?"<>|]+/g,'_').slice(0,80); }
`;
}
