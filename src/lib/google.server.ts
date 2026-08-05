// Server-only: персональный OAuth Google для каждого пользователя.
// Google запрещает запрашивать YouTube-скоупы вместе со скоупами Drive в одном согласии,
// поэтому используется инкрементальная авторизация: два независимых потока и два токена.
// Токены хранятся в public.google_connections и читаются только service-role клиентом.

export type GoogleProvider = "youtube" | "drive";

export const PROVIDER_SCOPES: Record<GoogleProvider, string> = {
  youtube: "https://www.googleapis.com/auth/youtube.readonly",
  drive: "https://www.googleapis.com/auth/drive.file",
};

export const PROVIDER_LABEL: Record<GoogleProvider, string> = {
  youtube: "YouTube",
  drive: "Google Диск",
};

export function isProvider(v: unknown): v is GoogleProvider {
  return v === "youtube" || v === "drive";
}

export function googleClientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GDRIVE_OAUTH_CLIENT_ID;
  if (!id) throw new Error("Не задан секрет GOOGLE_OAUTH_CLIENT_ID");
  return id;
}

export function googleClientSecret(): string {
  const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GDRIVE_OAUTH_CLIENT_SECRET;
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

export async function signState(
  userId: string,
  provider: GoogleProvider,
  returnTo = "/integrations",
): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ u: userId, p: provider, r: returnTo, t: Date.now() })),
  );
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyState(
  state: string,
): Promise<{ userId: string; provider: GoogleProvider; returnTo: string } | null> {
  const [payload, sig] = (state ?? "").split(".");
  if (!payload || !sig) return null;
  if ((await hmac(payload)) !== sig) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
      ),
    );
    if (!json?.u || !isProvider(json.p)) return null;
    if (Date.now() - Number(json.t ?? 0) > 30 * 60 * 1000) return null;
    return {
      userId: json.u as string,
      provider: json.p as GoogleProvider,
      returnTo: (json.r as string) || "/integrations",
    };
  } catch {
    return null;
  }
}

/**
 * Ссылка на согласие Google для одного сервиса.
 * include_granted_scopes НЕ используется: Google отклоняет запрос, где YouTube- и Drive-скоупы
 * оказываются в одном согласии («This request contains scopes that cannot be requested together»).
 */
export async function buildAuthUrl(
  userId: string,
  origin: string,
  provider: GoogleProvider,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: `openid email ${PROVIDER_SCOPES[provider]}`,
    access_type: "offline",
    prompt: "consent",
    state: await signState(userId, provider),
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
  drive_folder_id: string | null;
  scopes: string | null;
  connected_at: string;
  youtube_refresh_token: string | null;
  youtube_access_token: string | null;
  youtube_token_expires_at: string | null;
  youtube_connected_at: string | null;
  youtube_email: string | null;
  youtube_scopes: string | null;
  drive_refresh_token: string | null;
  drive_access_token: string | null;
  drive_token_expires_at: string | null;
  drive_connected_at: string | null;
  drive_email: string | null;
  drive_scopes: string | null;
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

/** Пользователи, у которых подключены оба сервиса (нужно для фоновых задач). */
export async function listConnectedUserIds(): Promise<string[]> {
  const db = await admin();
  const { data } = await db
    .from("google_connections")
    .select("user_id, youtube_refresh_token, drive_refresh_token");
  return (data ?? [])
    .filter((r: any) => r.youtube_refresh_token && r.drive_refresh_token)
    .map((r: any) => r.user_id as string);
}

export async function saveConnection(params: {
  userId: string;
  provider: GoogleProvider;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  email: string | null;
  scopes: string | null;
}) {
  const db = await admin();
  const p = params.provider;
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000).toISOString();
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {
    user_id: params.userId,
    google_email: params.email,
    connected_at: now,
    [`${p}_refresh_token`]: params.refreshToken,
    [`${p}_access_token`]: params.accessToken,
    [`${p}_token_expires_at`]: expiresAt,
    [`${p}_connected_at`]: now,
    [`${p}_email`]: params.email,
    [`${p}_scopes`]: params.scopes,
  };

  const { error } = await db.from("google_connections").upsert(patch, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

/** Отключение одного сервиса; строка удаляется, когда не осталось ни одного токена. */
export async function deleteConnection(userId: string, provider: GoogleProvider) {
  const db = await admin();
  const other: GoogleProvider = provider === "youtube" ? "drive" : "youtube";
  const conn = await getConnection(userId);
  if (!conn) return;

  const otherStillConnected = Boolean(conn[`${other}_refresh_token` as keyof GoogleConnectionRow]);
  if (!otherStillConnected) {
    await db.from("google_connections").delete().eq("user_id", userId);
    return;
  }

  await db
    .from("google_connections")
    .update({
      [`${provider}_refresh_token`]: null,
      [`${provider}_access_token`]: null,
      [`${provider}_token_expires_at`]: null,
      [`${provider}_connected_at`]: null,
      [`${provider}_email`]: null,
      [`${provider}_scopes`]: null,
      ...(provider === "drive" ? { drive_folder_id: null } : {}),
    })
    .eq("user_id", userId);
}

const NOT_CONNECTED: Record<GoogleProvider, string> = {
  youtube: "YouTube не подключён — откройте «Интеграции» и нажмите «Подключить YouTube»",
  drive: "Google Диск не подключён — откройте «Интеграции» и нажмите «Подключить Google Диск»",
};

/** Действующий access token нужного сервиса (с кешированием в строке подключения). */
export async function getUserGoogleToken(userId: string, provider: GoogleProvider): Promise<string> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error(NOT_CONNECTED[provider]);

  const refresh = conn[`${provider}_refresh_token` as keyof GoogleConnectionRow] as string | null;
  if (!refresh) throw new Error(NOT_CONNECTED[provider]);

  const access = conn[`${provider}_access_token` as keyof GoogleConnectionRow] as string | null;
  const expiresAt = conn[`${provider}_token_expires_at` as keyof GoogleConnectionRow] as string | null;
  const exp = expiresAt ? new Date(expiresAt).getTime() : 0;
  if (access && exp - Date.now() > 60_000) return access;

  const fresh = await refreshAccessToken(refresh);
  const db = await admin();
  await db
    .from("google_connections")
    .update({
      [`${provider}_access_token`]: fresh.access_token,
      [`${provider}_token_expires_at`]: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
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
