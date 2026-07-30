// Server-only Google Drive helpers. Авторизация ТОЛЬКО через OAuth refresh token.

export const DRIVE_AUTH_MODE = "oauth refresh token";

/** Обменивает refresh token на access token (единственный способ авторизации). */
export async function getAccessToken(): Promise<string> {
  const client_id = process.env.GDRIVE_OAUTH_CLIENT_ID;
  const client_secret = process.env.GDRIVE_OAUTH_CLIENT_SECRET;
  const refresh_token = process.env.GDRIVE_OAUTH_REFRESH_TOKEN;

  const missing = [
    !client_id && "GDRIVE_OAUTH_CLIENT_ID",
    !client_secret && "GDRIVE_OAUTH_CLIENT_SECRET",
    !refresh_token && "GDRIVE_OAUTH_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missing.length) throw new Error(`OAuth secrets missing: ${missing.join(", ")}`);

  console.log("[gdrive] auth: oauth refresh token");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client_id!,
      client_secret: client_secret!,
      refresh_token: refresh_token!,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Google OAuth [${res.status}]: ${body}`);
  const token = JSON.parse(body).access_token;
  if (!token) throw new Error("Google OAuth не вернул access_token");
  return token;
}

export function driveFolderId(): string {
  const id = process.env.GDRIVE_FOLDER_ID;
  if (!id) throw new Error("Не задан секрет GDRIVE_FOLDER_ID");
  return id;
}

const FOLDER_NAME = "Контент-завод";
let cachedFolderId: string | null = null;

/** Проверяет доступность папки из секрета, иначе создаёт «Контент-завод» в корне. */
export async function ensureDriveFolder(): Promise<{ id: string; created: boolean; name: string }> {
  if (cachedFolderId) return { id: cachedFolderId, created: false, name: FOLDER_NAME };

  const token = await getAccessToken();
  const fromSecret = process.env.GDRIVE_FOLDER_ID;

  if (fromSecret) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fromSecret)}?supportsAllDrives=true&fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const j = await res.json();
      if (!j.trashed) {
        cachedFolderId = j.id as string;
        return { id: j.id, created: false, name: j.name ?? FOLDER_NAME };
      }
    }
  }

  // Ищем уже созданную папку с нужным именем
  const q = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const find = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (find.ok) {
    const files = (await find.json()).files ?? [];
    if (files[0]?.id) {
      cachedFolderId = files[0].id;
      console.log(`[gdrive] Используется существующая папка "${FOLDER_NAME}": ${files[0].id}`);
      return { id: files[0].id, created: false, name: files[0].name ?? FOLDER_NAME };
    }
  }

  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const text = await create.text();
  if (!create.ok) throw new Error(`Drive create folder [${create.status}]: ${text}`);
  const j = JSON.parse(text);
  cachedFolderId = j.id as string;
  console.log(`[gdrive] Создана папка "${FOLDER_NAME}" с id: ${j.id} — сохраните его в секрет GDRIVE_FOLDER_ID`);
  return { id: j.id, created: true, name: j.name ?? FOLDER_NAME };
}


function b64url(bytes: Uint8Array | string): string {
  const str =
    typeof bytes === "string" ? bytes : String.fromCharCode(...Array.from(bytes));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function getAccessToken(): Promise<string> {
  const sa = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Google OAuth [${res.status}]: ${body}`);
  const token = JSON.parse(body).access_token;
  if (!token) throw new Error("Google OAuth не вернул access_token");
  return token;
}

export async function driveUploadText(
  name: string,
  content: string,
  mimeType = "text/plain",
): Promise<{ id: string; webViewLink: string | null; name: string }> {
  const token = await getAccessToken();
  const boundary = "lovable-boundary-" + crypto.randomUUID();
  const { id: folderId } = await ensureDriveFolder();
  const metadata = { name, parents: [folderId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
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

export async function driveListFolder(): Promise<
  Array<{ id: string; name: string; mimeType: string; webViewLink: string | null; modifiedTime: string | null }>
> {
  const token = await getAccessToken();
  const { id: folderId } = await ensureDriveFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive list [${res.status}]: ${text}`);
  return JSON.parse(text).files ?? [];
}
