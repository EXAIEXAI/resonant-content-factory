ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_last_sent_at timestamptz;