import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WORKSPACE_OWNER_ID } from "./workspace";

/** Сохраняет chat ID Telegram для ежедневной рассылки. */
export const saveTelegramChatId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { chat_id: string | null }) =>
    z.object({ chat_id: z.string().max(64).nullish() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const value = data.chat_id?.trim() || null;
    // Гарантируем наличие строки настроек, иначе update молча ничего не сохранит
    const { data: existing } = await context.supabase
      .from("integration_settings")
      .select("id")
      .eq("user_id", WORKSPACE_OWNER_ID)
      .maybeSingle();

    if (!existing) {
      const { error } = await context.supabase
        .from("integration_settings")
        .insert({ user_id: WORKSPACE_OWNER_ID, telegram_chat_id: value } as never);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("integration_settings")
        .update({ telegram_chat_id: value } as never)
        .eq("user_id", WORKSPACE_OWNER_ID);
      if (error) throw new Error(error.message);
    }

    const { data: saved } = await context.supabase
      .from("integration_settings")
      .select("telegram_chat_id")
      .eq("user_id", WORKSPACE_OWNER_ID)
      .maybeSingle();
    return { ok: true, chat_id: (saved as { telegram_chat_id: string | null } | null)?.telegram_chat_id ?? null };
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
    return await sendSavedDigest(context.supabase, WORKSPACE_OWNER_ID, opts);
  });
