import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Загружает текстовый файл в папку GDRIVE_FOLDER_ID. */
export const uploadTextFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; content: string }) =>
    z.object({ name: z.string().min(1).max(300), content: z.string().max(500000) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { driveUploadText } = await import("./gdrive.server");
    return await driveUploadText(data.name, data.content);
  });

/** Список файлов в папке GDRIVE_FOLDER_ID. */
export const listFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { driveListFolder } = await import("./gdrive.server");
    return { files: await driveListFolder() };
  });

/** Кладёт метаданные видео из yt_videos в Drive как <videoId>.json и сохраняет drive_file_id. */
export const syncVideoToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { videoId: string }) => z.object({ videoId: z.string().min(1).max(64) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("yt_videos")
      .select("*")
      .eq("video_id", data.videoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(`Видео ${data.videoId} нет в базе`);

    const { driveUploadText } = await import("./gdrive.server");
    const file = await driveUploadText(
      `${row.video_id}.json`,
      JSON.stringify(
        {
          video_id: row.video_id,
          channel_id: row.channel_id,
          title: row.title,
          published_at: row.published_at,
          url: row.url,
          thumbnail: row.thumbnail,
        },
        null,
        2,
      ),
      "application/json",
    );

    const upd = await supabase.from("yt_videos").update({ drive_file_id: file.id }).eq("id", row.id);
    if (upd.error) throw new Error(upd.error.message);
    return { videoId: row.video_id, driveFileId: file.id, webViewLink: file.webViewLink };
  });

/** Синхронизирует в Drive все записи yt_videos без drive_file_id. */
export const syncPendingVideosToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.from("yt_videos").select("*").is("drive_file_id", null);
    if (error) throw new Error(error.message);

    const { driveUploadText } = await import("./gdrive.server");
    const results: Array<{ videoId: string; ok: boolean; driveFileId?: string; webViewLink?: string | null; error?: string }> = [];
    for (const row of rows ?? []) {
      try {
        const file = await driveUploadText(
          `${row.video_id}.json`,
          JSON.stringify(
            {
              video_id: row.video_id,
              channel_id: row.channel_id,
              title: row.title,
              published_at: row.published_at,
              url: row.url,
              thumbnail: row.thumbnail,
            },
            null,
            2,
          ),
          "application/json",
        );
        await supabase.from("yt_videos").update({ drive_file_id: file.id }).eq("id", row.id);
        results.push({ videoId: row.video_id, ok: true, driveFileId: file.id, webViewLink: file.webViewLink });
      } catch (e: any) {
        results.push({ videoId: row.video_id, ok: false, error: e?.message ?? String(e) });
      }
    }
    return { total: rows?.length ?? 0, results };
  });
