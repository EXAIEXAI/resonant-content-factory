import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Статус подключения Google для текущего пользователя (без токенов). */
export const getGoogleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnection } = await import("./google.server");
    const conn = await getConnection(context.userId);
    if (!conn) return { connected: false as const, email: null, connectedAt: null, folderId: null, folderUrl: null };
    return {
      connected: true as const,
      email: conn.google_email,
      connectedAt: conn.connected_at,
      folderId: conn.drive_folder_id,
      folderUrl: conn.drive_folder_id ? `https://drive.google.com/drive/folders/${conn.drive_folder_id}` : null,
    };
  });

/** Возвращает ссылку на согласие Google (клиент делает по ней переход). */
export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { origin: string }) => ({ origin: String(data.origin).slice(0, 300) }))
  .handler(async ({ data, context }) => {
    const { buildAuthUrl } = await import("./google.server");
    return { url: await buildAuthUrl(context.userId, data.origin) };
  });

/** Отзывает токен в Google и удаляет подключение. */
export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnection, revokeToken, deleteConnection } = await import("./google.server");
    const conn = await getConnection(context.userId);
    if (conn) {
      await revokeToken(conn.refresh_token);
      await deleteConnection(context.userId);
    }
    return { ok: true };
  });
