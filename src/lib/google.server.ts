// Server-only: персональный OAuth Google (YouTube + Drive) для каждого пользователя.
// Токены хранятся в public.google_connections и читаются только service-role клиентом.

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

export function googleClientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("Не задан секрет GOOGLE_OAUTH_CLIENT_ID");
  return id;
}

export function googleClientSecret(): string {
  const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!s) throw new Error("Не задан секрет GOOGLE_OAUTH_CLIENT_SECRET");
  return s;
}

/** Единый redirect_uri: должен быть зарегистрирован в Google Cloud Console. */
export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/public/google/callback`;
}

// ---- подписанный state --------------------------------------------------

function stateKeyMaterial(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_URL;
  if (!k) throw new Error("Нет ключа для подписи state");
  return k;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stateKeyMaterial()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function signState(userId: string, returnTo = "/integrations"): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, r: returnTo, t: Date.now() })));
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(state: string): Promise<{ userId: string; returnTo: string } | null> {
  const [payload, sig] = (state ?? "").split(".");
  if (!payload || !sig) return null;
  if ((await hmac(payload)) !== sig) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
      ),
    );
    if (!json?.u) return null;
    if (Date.now() - Number(json.t ?? 0) > 30 * 60 * 1000) return null;
    return { userId: json.u as string, returnTo: (json.r as string) || "/integrations" };
  } catch {
    return null;
  }
}

export async function buildAuthUrl(userId: string, origin: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: await signState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ---- обмен кода / токенов ----------------------------------------------

export async function exchangeCode(code: string, origin: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Google OAuth [${r.status}]: ${body.slice(0, 300)}`);
  return JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

async function refreshAccessToken(refreshToken: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Google OAuth refresh [${r.status}]: ${body.slice(0, 300)}`);
  return JSON.parse(body) as { access_token: string; expires_in: number };
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return (await r.json())?.email ?? null;
  } catch {
    return null;
  }
}

export type GoogleConnectionRow = {
  id: string;
  user_id: string;
  google_email: string | null;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  drive_folder_id: string | null;
  scopes: string | null;
  connected_at: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function getConnection(userId: string): Promise<GoogleConnectionRow | null> {
  const db = await admin();
  const { data } = await db.from("google_connections").select("*").eq("user_id", userId).maybeSingle();
  return (data as GoogleConnectionRow) ?? null;
}

/** Список пользователей с активным подключением Google. */
export async function listConnectedUserIds(): Promise<string[]> {
  const db = await admin();
  const { data } = await db.from("google_connections").select("user_id");
  return (data ?? []).map((r: any) => r.user_id as string);
}

export async function saveConnection(params: {
  userId: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  email: string | null;
  scopes: string | null;
}) {
  const db = await admin();
  const { error } = await db.from("google_connections").upsert(
    {
      user_id: params.userId,
      refresh_token: params.refreshToken,
      access_token: params.accessToken,
      access_token_expires_at: new Date(Date.now() + params.expiresIn * 1000).toISOString(),
      google_email: params.email,
      scopes: params.scopes,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteConnection(userId: string) {
  const db = await admin();
  await db.from("google_connections").delete().eq("user_id", userId);
}

/** Действующий access token пользователя (с кешированием в строке подключения). */
export async function getUserGoogleToken(userId: string): Promise<string> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error("Google не подключён — откройте «Интеграции» и нажмите «Подключить Google»");

  const exp = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (conn.access_token && exp - Date.now() > 60_000) return conn.access_token;

  const fresh = await refreshAccessToken(conn.refresh_token);
  const db = await admin();
  await db
    .from("google_connections")
    .update({
      access_token: fresh.access_token,
      access_token_expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId);
  return fresh.access_token;
}

export async function revokeToken(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // отзыв best-effort
  }
}
