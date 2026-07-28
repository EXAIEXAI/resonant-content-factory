## Что делаем

Два способа добавить YouTube-ролик в «Контент-завод»:

1. **Вручную по ссылке** — прямо в приложении, на странице «Отраслевой радар». Вставляем URL, сервер сам вытаскивает метаданные и субтитры.
2. **Автоматически из плейлиста YouTube** — Шеф жмёт «Сохранить в плейлист "Контент-Завод"» на телефоне. Раз в 15 минут скрипт Google Apps Script (GAS) на аккаунте пользователя опрашивает плейлист, вытягивает субтитры, кладёт файл на Google Диск и шлёт вебхук в наше приложение.

Ключевая идея: **никаких платных YouTube API-ключей у Lovable не хранится**. Всё, что требует Google-авторизации (YouTube Data API, Drive), выполняется в GAS на стороне пользователя. Наша сторона — только приём вебхука и парсинг URL для ручных ссылок.

## Изменения по разделам

### 1. База данных (миграция)

Расширяем `raw_materials` под YouTube-специфику:
- `external_id text` — YouTube Video ID (уже есть), делаем уникальным
- `source_type text default 'manual'` — `youtube_playlist` | `youtube_manual` | `manual`
- `channel_title text` — автор ролика
- `duration_seconds int`
- `thumbnail_url text`
- `drive_file_id text`, `drive_file_url text` — ссылки на файл транскрипта на Диске
- `transcript_segments jsonb` — субтитры с таймкодами `[{start, dur, text}]`

Новая таблица `integration_settings` (одна строка на пользователя):
- `user_id uuid` (owner), `youtube_playlist_id`, `drive_folder_id`, `webhook_secret` (генерируется), `last_sync_at`
- RLS: только владелец читает/пишет, `service_role` — всё.

### 2. Публичный вебхук для GAS

Файл-роут `src/routes/api/public/hooks/youtube-playlist.ts` (POST):
- заголовок `x-webhook-secret` сверяется с `integration_settings.webhook_secret` (timing-safe)
- Zod-валидация тела: `video_id, title, channel_title, url, published_at, duration_seconds, thumbnail_url, drive_file_id?, drive_file_url?, transcript_segments[]`
- upsert в `raw_materials` по `external_id`; если строка уже была из «радара» — только выставляем `is_manual=true`, `source_type='youtube_playlist'`, дописываем `drive_*` и транскрипт.

### 3. Ручное добавление по URL (уже частично есть)

На `/radar` в диалоге «Ручной материал»:
- поле только URL
- при сабмите вызываем серверную функцию `ingestYoutubeUrl({url})`:
  - парсим ID из ссылки (`youtu.be/`, `watch?v=`, `shorts/`)
  - тянем публичные метаданные через oEmbed `https://www.youtube.com/oembed?url=...` (без ключей)
  - пробуем получить субтитры через публичный timedtext (`https://video.google.com/timedtext?lang=ru&v=ID`, fallback `lang=en`); если пусто — сохраняем без транскрипта
  - апсерт в `raw_materials` с `source_type='youtube_manual'`, `is_manual=true`
- для не-YouTube ссылок — старое поведение (сохранить как есть).

### 4. Страница «Интеграции»

Новый роут `src/routes/_authenticated/integrations.tsx`:
- поля: Playlist ID/URL, Drive Folder ID
- кнопка «Сгенерировать вебхук-секрет»
- блок «Скрипт для Google Apps Script» — готовый код с подставленными `PLAYLIST_ID`, `DRIVE_FOLDER_ID`, `WEBHOOK_URL`, `WEBHOOK_SECRET` и кнопкой «Копировать»
- краткая пошаговая инструкция: создать проект на script.google.com → вставить код → включить YouTube Data API v3 → задать триггер «каждые 15 минут» → авторизовать
- кнопка «Проверить последнюю синхронизацию» (показывает `last_sync_at` и число загруженных материалов).

Пункт в сайдбаре: «Интеграции» (иконка `Plug`).

### 5. Отображение в «Радаре»

Карточка ролика:
- бейдж «Выбор Шефа» если `source_type='youtube_playlist'`
- ссылка на оригинал YouTube + ссылка на Google Doc/JSON на Диске (если есть)
- на странице материала (`/materials/$id`) — блок «Транскрипт с таймкодами»: список `mm:ss — текст`, каждый таймкод — ссылка `youtube.com/watch?v=ID&t=Ns`.

Дедуп: апсерт по `external_id` (уникальный индекс) — карточка одна, флаг `is_manual` включается, если ролик пришёл из плейлиста.

## Что НЕ делаем этим ходом

- Никаких Google OAuth-коннекторов внутри приложения — вся Google-авторизация в GAS.
- Не трогаем закрытые сейчас разделы «Дайджесты» и «База знаний».
- Не парсим приватные/возрастные ролики (там субтитры недоступны без cookie) — сохраняем метаданные, транскрипт пустой.

## Технические детали

```text
GAS (аккаунт Шефа)          Lovable
─────────────────────       ─────────────────────
YouTube.PlaylistItems.list
  → новые video_id
timedtext / captions API
  → segments[]
Drive.Files.create
  → drive_file_id/url
fetch(WEBHOOK_URL, {
  headers: { x-webhook-secret },
  body: {video_id, ..., transcript_segments}
})                        → /api/public/hooks/youtube-playlist
                              upsert raw_materials by external_id
```

Ручной путь:
```text
UI /radar → ingestYoutubeUrl(url)
  → oembed (title, author, thumbnail)
  → timedtext (segments) [best-effort]
  → upsert raw_materials
```

Проверка после реализации: (1) сгенерировать секрет на /integrations, (2) POST-нуть тестовое тело в вебхук локально — карточка появляется в /radar с бейджем «Выбор Шефа», (3) вставить публичный YouTube URL в /radar → карточка появляется с транскриптом.
