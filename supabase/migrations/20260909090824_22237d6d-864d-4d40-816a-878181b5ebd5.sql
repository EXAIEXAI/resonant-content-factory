CREATE TABLE public.youtube_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  playlist_id text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, playlist_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_playlists TO authenticated;
GRANT ALL ON public.youtube_playlists TO service_role;

ALTER TABLE public.youtube_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared playlists" ON public.youtube_playlists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS playlist_id text,
  ADD COLUMN IF NOT EXISTS playlist_label text;

INSERT INTO public.youtube_playlists (user_id, playlist_id, label)
SELECT user_id, youtube_playlist_id, 'Основной плейлист'
FROM public.integration_settings
WHERE youtube_playlist_id IS NOT NULL AND btrim(youtube_playlist_id) <> ''
ON CONFLICT DO NOTHING;