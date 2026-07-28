
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;

CREATE INDEX IF NOT EXISTS channels_platform_active_idx
  ON public.channels (platform, active);
