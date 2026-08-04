// Server-only: отправка ежедневного списка сохранённых роликов в Telegram.
import type { SupabaseClient } from "@supabase/supabase-js";

type AnyClient = SupabaseClient<any, any, any>;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const APP_URL = "https://resonant-content-factory.lovable.app";

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY не настроен");
  if (!connKey) throw new Error("TELEGRAM_API_KEY не настроен — подключите Telegram в интеграциях");

  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Telegram ${method} [${res.status}]: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json?.ok === false) throw new Error(`Telegram ${method}: ${json.description ?? "ошибка"}`);
  return json.result;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Границы «вчерашнего дня» по московскому времени в UTC ISO. */
export function yesterdayRangeMsk(now = new Date()): { from: string; to: string; label: string } {
  const MSK = 3 * 60 * 60 * 1000;
  const msk = new Date(now.getTime() + MSK);
  const startOfTodayMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - MSK;
  const from = new Date(startOfTodayMsk - 24 * 60 * 60 * 1000);
  const to = new Date(startOfTodayMsk);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: new Date(from.getTime() + MSK).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
  };
}

export type TelegramDigestResult = {
  chatId: string | null;
  materials: number;
  sent: number;
  skipped: string | null;
};

/**
 * Отправляет в Telegram список роликов, сохранённых в плейлист за указанный период.
 * По умолчанию — за вчерашний день (МСК).
 */
export async function sendSavedDigest(
  supabase: AnyClient,
  userId: string,
  opts?: { from?: string; to?: string; chatId?: string | null; title?: string },
): Promise<TelegramDigestResult> {
  const { data: settings } = await supabase
    .from("integration_settings")
    .select("telegram_chat_id")
    .eq("user_id", userId)
    .maybeSingle();

  const raw = (opts?.chatId ?? settings?.telegram_chat_id ?? "").toString();
  const chatIds = raw
    .split(/[,\s;]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!chatIds.length) return { chatId: null, materials: 0, sent: 0, skipped: "Не указан Telegram chat ID" };

  const range = yesterdayRangeMsk();
  const from = opts?.from ?? range.from;
  const to = opts?.to ?? range.to;

  const { data: rows, error } = await supabase
    .from("raw_materials")
    .select("id, title, url, external_id, summary, channel_title, created_at")
    .eq("source_type", "youtube_saved")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const materials = rows ?? [];
  if (!materials.length) {
    return { chatId: chatIds.join(", "), materials: 0, sent: 0, skipped: "За период нет сохранённых роликов" };
  }

  const header = opts?.title ?? `<b>Вчера вы сохранили эти видеоролики</b> (${range.label})`;

  let sent = 0;
  for (const chatId of chatIds) {
    await tg("sendMessage", { chat_id: chatId, text: header, parse_mode: "HTML" });

    for (const m of materials) {
      const url = m.url || (m.external_id ? `https://www.youtube.com/watch?v=${m.external_id}` : null);
      const summary = (m.summary ?? "").trim();
      const text =
        `<b>${esc(m.title ?? "Без названия")}</b>` +
        (m.channel_title ? `\n<i>${esc(m.channel_title)}</i>` : "") +
        (summary ? `\n\n${esc(summary.slice(0, 600))}` : "\n\nКраткое описание готовится.");

      const buttons: Array<Array<Record<string, string>>> = [[]];
      if (url) buttons[0].push({ text: "▶ Смотреть", url });
      buttons[0].push({ text: "Читать обзор", url: `${APP_URL}/materials/${m.id}` });

      await tg("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup: { inline_keyboard: buttons },
      });
      sent++;
    }
  }

  await supabase
    .from("integration_settings")
    .update({ telegram_last_sent_at: new Date().toISOString() })
    .eq("user_id", userId);

  return { chatId: chatIds.join(", "), materials: materials.length, sent, skipped: null };
}

