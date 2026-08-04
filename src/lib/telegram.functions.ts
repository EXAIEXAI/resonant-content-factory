import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Сохраняет chat ID Telegram для ежедневной рассылки. */
export const saveTelegramChatId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { chat_id: string | null }) =>
    z.object({ chat_id: z.string().max(64).nullish() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("integration_settings")
      .update({ telegram_chat_id: data.chat_id?.trim() || null } as never)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Отправляет список сохранённых роликов в Telegram прямо сейчас. */
export const sendTelegramDigestNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { days?: number } | undefined) =>
    z.object({ days: z.number().int().min(1).max(30).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { sendSavedDigest, yesterdayRangeMsk } = await import("./telegram.server");
    const range = yesterdayRangeMsk();
    const opts =
      data.days && data.days > 1
        ? {
            from: new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString(),
            title: `<b>Ролики, сохранённые за последние ${data.days} дн.</b>`,
          }
        : { from: range.from, to: range.to };
    return await sendSavedDigest(context.supabase, context.userId, opts);
  });
