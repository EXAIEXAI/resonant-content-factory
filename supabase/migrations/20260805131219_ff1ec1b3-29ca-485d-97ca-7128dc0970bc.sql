ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS youtube_refresh_token text,
  ADD COLUMN IF NOT EXISTS youtube_access_token text,
  ADD COLUMN IF NOT EXISTS youtube_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_email text,
  ADD COLUMN IF NOT EXISTS youtube_scopes text,
  ADD COLUMN IF NOT EXISTS drive_refresh_token text,
  ADD COLUMN IF NOT EXISTS drive_access_token text,
  ADD COLUMN IF NOT EXISTS drive_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_email text,
  ADD COLUMN IF NOT EXISTS drive_scopes text;

UPDATE public.google_connections
SET drive_refresh_token = COALESCE(drive_refresh_token, refresh_token),
    drive_access_token = COALESCE(drive_access_token, access_token),
    drive_token_expires_at = COALESCE(drive_token_expires_at, access_token_expires_at),
    drive_connected_at = COALESCE(drive_connected_at, connected_at),
    drive_email = COALESCE(drive_email, google_email),
    drive_scopes = COALESCE(drive_scopes, scopes);

ALTER TABLE public.google_connections
  ALTER COLUMN refresh_token DROP NOT NULL;

ALTER TABLE public.google_connections
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS access_token_expires_at;

REVOKE ALL ON public.google_connections FROM anon, authenticated;
GRANT SELECT (id, user_id, google_email, drive_folder_id, scopes, connected_at,
              youtube_connected_at, youtube_email, youtube_scopes,
              drive_connected_at, drive_email, drive_scopes)
  ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;