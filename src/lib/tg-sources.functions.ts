import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WORKSPACE_OWNER_ID } from "./workspace";

export const syncTelegramChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ channelId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { ingestTelegramChannel } = await import("./tg-sources.server");
    const { data: ch, error } = await context.supabase
      .from("channels")
      .select("id, url, title, external_id, platform")
      .eq("id", data.channelId)
      .maybeSingle();
    if (error || !ch) throw new Error("Канал не найден");
    if (ch.platform !== "telegram") throw new Error("Это не Telegram-канал");
    return ingestTelegramChannel(context.supabase, WORKSPACE_OWNER_ID, ch as any);
  });

export const syncAllTelegramChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ingestTelegramChannel } = await import("./tg-sources.server");
    const { data: chs } = await context.supabase
      .from("channels")
      .select("id, url, title, external_id")
      .eq("user_id", WORKSPACE_OWNER_ID)
      .eq("platform", "telegram")
      .eq("active", true);
    let added = 0;
    let processed = 0;
    for (const ch of chs ?? []) {
      try {
        const r = await ingestTelegramChannel(context.supabase, WORKSPACE_OWNER_ID, ch as any);
        added += r.added;
        processed += 1;
      } catch (e) {
        console.error("tg sync failed", ch.id, e);
      }
    }
    return { channels: processed, added };
  });
