import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WORKSPACE_OWNER_ID } from "./workspace";

/** Возвращает id рабочей папки Диска, создавая «Контент-завод» при необходимости. */
export const ensureFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureDriveFolder } = await import("./gdrive.server");
    return await ensureDriveFolder(WORKSPACE_OWNER_ID);
  });

/** Загружает текстовый файл в рабочую папку Диска. */
export const uploadTextFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; content: string }) =>
    z.object({ name: z.string().min(1).max(300), content: z.string().max(500000) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { driveUploadText } = await import("./gdrive.server");
    return await driveUploadText(WORKSPACE_OWNER_ID, data.name, data.content);
  });

/** Список файлов в рабочей папке Диска. */
export const listFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { driveListFolder } = await import("./gdrive.server");
    return { files: await driveListFolder(WORKSPACE_OWNER_ID) };
  });

/** Проверка подключения к Google Drive: OAuth пользователя + рабочая папка. */
export const checkDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureDriveFolder, DRIVE_AUTH_MODE } = await import("./gdrive.server");
    try {
      const folder = await ensureDriveFolder(WORKSPACE_OWNER_ID);
      return {
        ok: true as const,
        auth: DRIVE_AUTH_MODE,
        folderId: folder.id,
        folderName: folder.name,
        folderUrl: folder.url,
        error: null as string | null,
      };
    } catch (e) {
      return {
        ok: false as const,
        auth: DRIVE_AUTH_MODE,
        folderId: null,
        folderName: null,
        folderUrl: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
