-- 1. google_connections
CREATE TABLE public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  drive_folder_id text,
  scopes text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

REVOKE ALL ON public.google_connections FROM anon, authenticated;
GRANT SELECT (id, user_id, google_email, drive_folder_id, scopes, connected_at) ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own google connection readable"
  ON public.google_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 2. ownership on channels / raw_materials
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.channels SET user_id = 'da5626be-9b3a-435b-a3c6-ecc015c05217' WHERE user_id IS NULL;
UPDATE public.raw_materials SET user_id = COALESCE(added_by, 'da5626be-9b3a-435b-a3c6-ecc015c05217') WHERE user_id IS NULL;

ALTER TABLE public.channels ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.raw_materials ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS channels_user_id_idx ON public.channels(user_id);
CREATE INDEX IF NOT EXISTS raw_materials_user_id_idx ON public.raw_materials(user_id);

-- 3. per-user uniqueness of external_id
ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_external_id_key;
ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_external_id_unique;
DROP INDEX IF EXISTS public.raw_materials_external_id_idx;
ALTER TABLE public.raw_materials
  ADD CONSTRAINT raw_materials_user_external_unique UNIQUE (user_id, external_id);

-- 4. RLS: own rows only
DROP POLICY IF EXISTS "channels read" ON public.channels;
DROP POLICY IF EXISTS "channels write" ON public.channels;
CREATE POLICY "own channels" ON public.channels FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "materials read" ON public.raw_materials;
DROP POLICY IF EXISTS "materials write" ON public.raw_materials;
CREATE POLICY "own materials" ON public.raw_materials FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);