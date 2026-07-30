// Server-only Google Drive helpers (service-account JWT auth).

type ServiceAccount = { client_email: string; private_key: string };

function readServiceAccount(): ServiceAccount {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Не задан секрет GDRIVE_SERVICE_ACCOUNT_JSON");
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("GDRIVE_SERVICE_ACCOUNT_JSON не является корректным JSON");
  }
  if (!json.client_email || !json.private_key) {
    throw new Error("В GDRIVE_SERVICE_ACCOUNT_JSON нет client_email или private_key");
  }
  return { client_email: json.client_email, private_key: String(json.private_key).replace(/\\n/g, "\n") };
}

export function driveFolderId(): string {
  const id = process.env.GDRIVE_FOLDER_ID;
  if (!id) throw new Error("Не задан секрет GDRIVE_FOLDER_ID");
  return id;
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
  const metadata = { name, parents: [driveFolderId()] };
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
  const q = encodeURIComponent(`'${driveFolderId()}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive list [${res.status}]: ${text}`);
  return JSON.parse(text).files ?? [];
}
