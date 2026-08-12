import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WORKSPACE_OWNER_ID } from "./workspace";

type Provider = "youtube" | "drive";
const asProvider = (v: unknown): Provider => (v === "youtube" ? "youtube" : "drive");

/** Статус подключений YouTube и Google Диска для текущего пользователя (без токенов). */
export const getGoogleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnection } = await import("./google.server");
    const conn = await getConnection(WORKSPACE_OWNER_ID);
    return {
      youtube: {
        connected: Boolean(conn?.youtube_refresh_token),
        email: conn?.youtube_email ?? null,
        connectedAt: conn?.youtube_connected_at ?? null,
      },
      drive: {
        connected: Boolean(conn?.drive_refresh_token),
        email: conn?.drive_email ?? null,
        connectedAt: conn?.drive_connected_at ?? null,
        folderId: conn?.drive_folder_id ?? null,
        folderUrl: conn?.drive_folder_id
          ? `https://drive.google.com/drive/folders/${conn.drive_folder_id}`
          : null,
      },
    };
  });

/** Возвращает ссылку на согласие Google для одного сервиса (клиент делает по ней переход). */
export const startGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { origin: string; provider: Provider }) => ({
    origin: String(data.origin).slice(0, 300),
    provider: asProvider(data.provider),
  }))
  .handler(async ({ data, context }) => {
    const { buildAuthUrl } = await import("./google.server");
    return { url: await buildAuthUrl(WORKSPACE_OWNER_ID, data.origin, data.provider) };
  });

/** Отзывает токен сервиса в Google и удаляет его из подключения. */
export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: Provider }) => ({ provider: asProvider(data.provider) }))
  .handler(async ({ data, context }) => {
    const { getConnection, revokeToken, deleteConnection } = await import("./google.server");
    const conn = await getConnection(WORKSPACE_OWNER_ID);
    if (conn) {
      const token =
        data.provider === "youtube" ? conn.youtube_refresh_token : conn.drive_refresh_token;
      if (token) await revokeToken(token);
      await deleteConnection(WORKSPACE_OWNER_ID, data.provider);
    }
    return { ok: true, provider: data.provider };
  });
