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
import { Copy, RefreshCcw } from "lucide-react";
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
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (settings) {
      setPlaylist(settings.youtube_playlist_id ?? "");
      setFolder(settings.drive_folder_id ?? "");
      setApiKey((settings as { youtube_api_key?: string | null }).youtube_api_key ?? "");
    }
  }, [settings]);

  const saveM = useMutation({
    mutationFn: () =>
      save({ data: { playlist_id: playlist, drive_folder_id: folder, youtube_api_key: apiKey } }),
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

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/public/hooks/youtube-playlist` : "";
  const channelsUrl = origin ? `${origin}/api/public/hooks/youtube-channels` : "";
  const secret = settings?.webhook_secret ?? "";

  const gasCode = useMemo(
    () => buildGasScript({
      playlistId: playlist || "PLAYLIST_ID",
      folderId: folder || "DRIVE_FOLDER_ID",
      webhookUrl,
      channelsUrl,
      secret: secret || "WEBHOOK_SECRET",
    }),
    [playlist, folder, webhookUrl, channelsUrl, secret],
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
          Автоматический сбор роликов из YouTube через ваш Google-аккаунт (Google Apps Script).
          Скрипт раз в 15 минут забирает новые ролики <b>из плейлиста</b> (если указан) и <b>из всех YouTube-каналов</b>,
          добавленных в разделе «Источники». Ролики сохраняются в папку Google Диска и отправляются в приложение.
          API-ключи с нашей стороны не требуются.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">1. Что понадобится</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc ml-5 space-y-1">
            <li>Google-аккаунт с доступом к YouTube и Google Диску.</li>
            <li>ID папки Google Диска (часть URL после <code>/folders/</code>) — туда GAS складывает JSON-файлы роликов.</li>
            <li><b>Опционально</b> — ID плейлиста YouTube (часть URL после <code>list=</code>), если хотите добавлять отдельные ролики через плейлист.</li>
            <li>Список каналов ведётся прямо в приложении: раздел <b>«Источники»</b> → «Добавить источник» → вставьте URL канала (<code>youtube.com/@handle</code> или <code>/channel/UC…</code>).</li>
          </ul>
        </CardContent>
      </Card>


      <Card>
        <CardHeader><CardTitle className="font-serif">2. Настройки</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Папка на Google Диске (ID) <span className="text-destructive">*</span></Label>
            <Input value={folder} onChange={e => setFolder(e.target.value)} placeholder="1AbCdEf... — из URL папки" />
          </div>
          <div>
            <Label>Плейлист YouTube (опционально)</Label>
            <Input value={playlist} onChange={e => setPlaylist(e.target.value)} placeholder="https://www.youtube.com/playlist?list=PLxxxx" />
            <p className="text-xs text-muted-foreground mt-1">Если пусто — GAS обрабатывает только каналы из «Источников».</p>
          </div>
          <div>
            <Label>YouTube Data API v3 — ключ <span className="text-destructive">*</span></Label>
            <Input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIza..."
              type="password"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Нужен для получения реальных просмотров, лайков и комментариев при добавлении и пересчёте роликов.
              Получить: <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com</a> → создать проект → «Enable APIs» → включить <b>YouTube Data API v3</b> → «Credentials» → «Create credentials» → «API key». Ключ хранится только у вас.
            </p>
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
            <li>Вставьте код ниже и сохраните проект.</li>
            <li>Слева «Службы» (Services) → добавьте <b>YouTube Data API v3</b>.</li>
            <li>Запустите функцию <code>syncAll()</code> вручную один раз и подтвердите доступ к YouTube и Google Диску.</li>
            <li>Слева «Триггеры» → «По времени» → <code>syncAll</code>, каждые 15 минут.</li>
          </ol>
          <Textarea readOnly value={gasCode} rows={22} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">
            Каналы читаются из приложения (endpoint <code className="text-[10px]">{channelsUrl || "/api/public/hooks/youtube-channels"}</code>).
            При первом прогоне канала берутся ролики за последние 30 дней, дальше — только новые.
            Субтитры отправляются, если доступны публично; иначе материал сохраняется без транскрипта.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}



function buildGasScript(o: { playlistId: string; folderId: string; webhookUrl: string; channelsUrl: string; secret: string }): string {
  return `// Content-Factory · автосбор YouTube (плейлист + каналы)
const PLAYLIST_ID = '${o.playlistId}';
const DRIVE_FOLDER_ID = '${o.folderId}';
const WEBHOOK_URL = '${o.webhookUrl}';
const CHANNELS_URL = '${o.channelsUrl}';
const WEBHOOK_SECRET = '${o.secret}';

// Триггер по времени: раз в 15 минут. Обрабатывает и плейлист, и все YouTube-каналы,
// добавленные в разделе «Источники» приложения.
function syncAll() {
  try { sync(); } catch (e) { Logger.log('sync failed: ' + e); }
  try { syncChannels(); } catch (e) { Logger.log('syncChannels failed: ' + e); }
}

// ==== Каналы из приложения ====
function syncChannels() {
  const resp = UrlFetchApp.fetch(CHANNELS_URL, {
    method: 'get',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    Logger.log('channels list error: ' + resp.getContentText()); return;
  }
  const list = JSON.parse(resp.getContentText()).channels || [];
  const props = PropertiesService.getScriptProperties();
  const processed = JSON.parse(props.getProperty('processed') || '{}');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  for (const ch of list) {
    try {
      const info = resolveChannel(ch);
      if (!info || !info.uploads) continue;

      // Обновим external_id/название один раз
      if (info.channelId !== ch.external_id || (info.title && info.title !== ch.title)) {
        postJson(CHANNELS_URL, {
          id: ch.id, external_id: info.channelId, title: info.title, subscribers: info.subscribers,
        });
      }

      // Первый прогон канала — не заливаем всё подряд, отсекаем по «сейчас минус 30 дней».
      const cursorKey = 'ch_' + ch.id;
      const cursor = props.getProperty(cursorKey);
      const cutoff = cursor ? new Date(cursor) : new Date(Date.now() - 30 * 86400000);
      let newest = cutoff;

      let pageToken = null;
      pageLoop: do {
        const r = YouTube.PlaylistItems.list('snippet,contentDetails', {
          playlistId: info.uploads, maxResults: 50, pageToken,
        });
        for (const it of (r.items || [])) {
          const vid = it.contentDetails.videoId;
          const pub = new Date(it.contentDetails.videoPublishedAt || it.snippet.publishedAt);
          if (pub <= cutoff) break pageLoop; // uploads-плейлист отсортирован по дате
          if (processed[vid]) continue;
          if (pub > newest) newest = pub;
          ingestVideo(vid, folder, processed);
        }
        pageToken = r.nextPageToken;
      } while (pageToken);

      props.setProperty(cursorKey, newest.toISOString());
      postJson(CHANNELS_URL, { id: ch.id, mark_polled: true });
    } catch (e) {
      Logger.log('channel ' + ch.url + ' failed: ' + e);
    }
  }
  props.setProperty('processed', JSON.stringify(processed));
}

function resolveChannel(ch) {
  // Уже разрезолвлен раньше
  if (ch.external_id && /^UC[\\w-]{20,}$/.test(ch.external_id)) {
    return fetchChannelInfo(ch.external_id);
  }
  const url = String(ch.url || '');
  let m;
  if ((m = url.match(/\\/channel\\/(UC[\\w-]+)/))) return fetchChannelInfo(m[1]);
  if ((m = url.match(/[?&]list=([\\w-]+)/))) {
    // Уже плейлист — используем его как uploads
    return { channelId: null, uploads: m[1], title: ch.title, subscribers: null };
  }
  // @handle / c/ user/
  let handle = null;
  if ((m = url.match(/\\/@([^\\/?#]+)/))) handle = '@' + m[1];
  else if ((m = url.match(/\\/(?:c|user)\\/([^\\/?#]+)/))) handle = m[1];
  if (handle) {
    const r = YouTube.Channels.list('snippet,contentDetails,statistics', { forHandle: handle });
    const v = r.items && r.items[0];
    if (v) return normalizeChannel(v);
    // fallback: поиск по хэндлу
    const s = YouTube.Search.list('snippet', { q: handle, type: 'channel', maxResults: 1 });
    const cid = s.items && s.items[0] && s.items[0].snippet.channelId;
    if (cid) return fetchChannelInfo(cid);
  }
  return null;
}

function fetchChannelInfo(channelId) {
  const r = YouTube.Channels.list('snippet,contentDetails,statistics', { id: channelId });
  const v = r.items && r.items[0];
  return v ? normalizeChannel(v) : null;
}

function normalizeChannel(v) {
  return {
    channelId: v.id,
    uploads: v.contentDetails.relatedPlaylists.uploads,
    title: v.snippet.title,
    subscribers: parseInt((v.statistics && v.statistics.subscriberCount) || '0', 10),
  };
}

// ==== Плейлист (как раньше) ====
function sync() {
  if (!PLAYLIST_ID || PLAYLIST_ID === 'PLAYLIST_ID') return;
  const props = PropertiesService.getScriptProperties();
  const processed = JSON.parse(props.getProperty('processed') || '{}');
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  let pageToken = null;
  do {
    const res = YouTube.PlaylistItems.list('snippet,contentDetails', {
      playlistId: PLAYLIST_ID, maxResults: 50, pageToken,
    });
    for (const it of (res.items || [])) {
      const vid = it.contentDetails.videoId;
      if (processed[vid]) continue;
      ingestVideo(vid, folder, processed);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
  props.setProperty('processed', JSON.stringify(processed));
}

// ==== Общая заливка одного ролика ====
function ingestVideo(vid, folder, processed) {
  try {
    const meta = fetchMeta(vid);
    if (!meta) return;
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
    } else {
      Logger.log('Webhook error ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }
  } catch (e) { Logger.log('Video ' + vid + ' failed: ' + e); }
}

function postJson(url, body) {
  UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });
}

function fetchMeta(vid) {
  const r = YouTube.Videos.list('snippet,contentDetails', { id: vid });
  const v = r.items && r.items[0];
  if (!v) return null;
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
