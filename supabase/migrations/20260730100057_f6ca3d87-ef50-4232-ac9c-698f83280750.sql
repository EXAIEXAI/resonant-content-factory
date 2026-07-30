CREATE TABLE public.yt_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text,
  video_id text NOT NULL UNIQUE,
  title text,
  published_at timestamptz,
  url text,
  thumbnail text,
  drive_file_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.yt_videos TO authenticated;
GRANT ALL ON public.yt_videos TO service_role;

ALTER TABLE public.yt_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "yt_videos read" ON public.yt_videos FOR SELECT TO authenticated USING (true);
CREATE POLICY "yt_videos write" ON public.yt_videos FOR ALL TO authenticated USING (true) WITH CHECK (true);