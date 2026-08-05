// Server-only Google Drive: работает от имени конкретного пользователя (персональный OAuth).
import { getUserGoogleToken, getConnection } from "./google.server";

export const DRIVE_AUTH_MODE = "персональный OAuth пользователя";

const FOLDER_NAME = "Контент-завод";

/**
 * Возвращает папку «Контент-завод» на Диске пользователя.
 * Scope drive.file видит только файлы/папки, созданные приложением,
 * поэтому папка создаётся приложением и её id хранится в google_connections.
 */
export async function ensureDriveFolder(
  userId: string,
): Promise<{ id: string; created: boolean; name: string; url: string }> {
  const token = await getUserGoogleToken(userId, "drive");
  const conn = await getConnection(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  if (conn?.drive_folder_id) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(conn.drive_folder_id)}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const j = await res.json();
      if (!j.trashed) {
        return {
          id: j.id,
          created: false,
          name: j.name ?? FOLDER_NAME,
          url: `https://drive.google.com/drive/folders/${j.id}`,
        };
      }
    }
  }

  // Ищем ранее созданную приложением папку с тем же именем.
  const q = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const find = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let id: string | null = null;
  let created = false;
  if (find.ok) id = (await find.json())?.files?.[0]?.id ?? null;

  if (!id) {
    const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
    });
    const text = await create.text();
    if (!create.ok) throw new Error(`Drive create folder [${create.status}]: ${text}`);
    id = JSON.parse(text).id as string;
    created = true;
  }

  await db.from("google_connections").update({ drive_folder_id: id }).eq("user_id", userId);
  return { id: id!, created, name: FOLDER_NAME, url: `https://drive.google.com/drive/folders/${id}` };
}

export async function driveUploadText(
  userId: string,
  name: string,
  content: string,
  mimeType = "text/plain",
): Promise<{ id: string; webViewLink: string | null; name: string }> {
  const token = await getUserGoogleToken(userId, "drive");
  const { id: folderId } = await ensureDriveFolder(userId);
  const boundary = "lovable-boundary-" + crypto.randomUUID();
  const metadata = { name, parents: [folderId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive upload [${res.status}]: ${text}`);
  const j = JSON.parse(text);
  return { id: j.id, webViewLink: j.webViewLink ?? null, name: j.name ?? name };
}

export async function driveListFolder(userId: string): Promise<
  Array<{ id: string; name: string; mimeType: string; webViewLink: string | null; modifiedTime: string | null }>
> {
  const token = await getUserGoogleToken(userId, "drive");
  const { id: folderId } = await ensureDriveFolder(userId);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&orderBy=modifiedTime desc&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive list [${res.status}]: ${text}`);
  return JSON.parse(text).files ?? [];
}
