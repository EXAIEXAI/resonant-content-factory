/** Парсинг публичных Telegram-каналов через веб-превью t.me/s/<channel>. */

export type TgPost = {
  postId: string;
  channelName: string;
  url: string;
  text: string;
  title: string;
  publishedAt: string | null;
  views: number;
  photo: string | null;
};

/** Из ссылки вида https://t.me/name или @name достаём короткое имя канала. */
export function parseTelegramHandle(input: string): string | null {
  const raw = input.trim();
  if (raw.startsWith("@")) return raw.slice(1).replace(/[^a-zA-Z0-9_]/g, "") || null;
  const m = raw.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{3,})/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_]{3,}$/.test(raw)) return raw;
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseViews(v: string | undefined): number {
  if (!v) return 0;
  const s = v.trim().toUpperCase().replace(/\s/g, "");
  const num = parseFloat(s.replace(/[KM]/g, ""));
  if (Number.isNaN(num)) return 0;
  if (s.endsWith("K")) return Math.round(num * 1000);
  if (s.endsWith("M")) return Math.round(num * 1_000_000);
  return Math.round(num);
}

/** Забираем последние посты публичного канала. Возвращает пустой массив, если канал закрыт. */
export async function fetchTelegramPosts(handle: string): Promise<{ channelTitle: string | null; posts: TgPost[] }> {
  const r = await fetch(`https://t.me/s/${handle}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ru,en;q=0.9" },
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
  const html = await r.text();

  const channelTitle =
    decodeEntities(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "") || null;

  const posts: TgPost[] = [];
  const blockRe = /<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"([\s\S]*?)(?=<div class="tgme_widget_message[^"]*"[^>]*data-post="|<\/section>)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const dataPost = m[1];
    const body = m[2];
    const [chName, postId] = dataPost.split("/");
    if (!postId) continue;
    const textHtml = body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const text = decodeEntities(textHtml);
    const publishedAt = body.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null;
    const views = parseViews(body.match(/tgme_widget_message_views">([^<]+)</)?.[1]);
    const photo = body.match(/background-image:url\('([^']+)'\)/)?.[1] ?? null;
    if (!text && !photo) continue;
    const firstLine = (text.split("\n").find(l => l.trim().length > 0) ?? "").trim();
    posts.push({
      postId,
      channelName: chName,
      url: `https://t.me/${chName}/${postId}`,
      text,
      title: (firstLine || `Пост #${postId}`).slice(0, 200),
      publishedAt,
      views,
      photo,
    });
  }
  return { channelTitle, posts };
}

/** Загружаем посты канала в raw_materials (upsert по external_id). */
export async function ingestTelegramChannel(
  supabase: any,
  userId: string,
  channelRow: { id: string; url: string; title: string; external_id: string | null },
): Promise<{ added: number; total: number; message?: string }> {
  const handle = channelRow.external_id || parseTelegramHandle(channelRow.url);
  if (!handle) return { added: 0, total: 0, message: "Не удалось определить имя канала" };

  let parsed;
  try {
    parsed = await fetchTelegramPosts(handle);
  } catch (e: any) {
    return { added: 0, total: 0, message: e?.message ?? "Ошибка запроса к Telegram" };
  }
  const { channelTitle, posts } = parsed;
  if (posts.length === 0) {
    return { added: 0, total: 0, message: "Посты не найдены — канал закрыт или пуст" };
  }

  const finalTitle = channelTitle || channelRow.title;
  await supabase
    .from("channels")
    .update({ external_id: handle, title: finalTitle, last_polled_at: new Date().toISOString() })
    .eq("id", channelRow.id);

  let added = 0;
  for (const p of posts) {
    const externalId = `tg_${handle}_${p.postId}`;
    const { data: existing } = await supabase
      .from("raw_materials")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", externalId)
      .maybeSingle();

    const { error } = await supabase.from("raw_materials").upsert(
      {
        user_id: userId,
        added_by: userId,
        external_id: externalId,
        channel_id: channelRow.id,
        title: p.title,
        channel_title: finalTitle,
        url: p.url,
        thumbnail_url: p.photo,
        published_at: p.publishedAt,
        views: p.views,
        raw_transcript: p.text,
        source_type: "telegram_channel",
        status: existing ? undefined : "found",
        is_manual: false,
        promoted_to_radar: true,
      },
      { onConflict: "user_id,external_id" },
    );
    if (error) continue;
    if (!existing) added += 1;
  }
  return { added, total: posts.length };
}
