
-- Roles enum + user_roles
CREATE TYPE public.app_role AS ENUM ('admin', 'product_owner', 'expert', 'editor');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Handle new user trigger: create profile + default 'editor' role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'editor');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Channels
CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('youtube','telegram','other')),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  subscribers INT DEFAULT 0,
  weight_factors JSONB NOT NULL DEFAULT '{"reach":0.3,"depth":0.3,"velocity":0.2,"age":0.2}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels read" ON public.channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "channels write" ON public.channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Raw materials
CREATE TABLE public.raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  url TEXT,
  raw_transcript TEXT,
  summary TEXT,
  key_points JSONB DEFAULT '[]'::jsonb,
  views INT DEFAULT 0,
  reactions INT DEFAULT 0,
  comments_count INT DEFAULT 0,
  published_at TIMESTAMPTZ,
  engagement_score NUMERIC DEFAULT 0,
  is_manual BOOLEAN NOT NULL DEFAULT false,
  category TEXT DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'found' CHECK (status IN ('found','in_digest','awaiting_expert','in_production','review','ready','published','archived')),
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials TO authenticated;
GRANT ALL ON public.raw_materials TO service_role;
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "materials read" ON public.raw_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "materials write" ON public.raw_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Digests
CREATE TABLE public.digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sent')),
  content_json JSONB DEFAULT '{}'::jsonb,
  material_ids UUID[] DEFAULT ARRAY[]::UUID[],
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digests TO authenticated;
GRANT ALL ON public.digests TO service_role;
ALTER TABLE public.digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "digests all" ON public.digests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Expert positions
CREATE TABLE public.expert_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  audio_url TEXT,
  transcript TEXT,
  reaction_type TEXT DEFAULT 'comment' CHECK (reaction_type IN ('agree','disagree','question','comment','aphorism')),
  timecode TEXT,
  linked_thesis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_positions TO authenticated;
GRANT ALL ON public.expert_positions TO service_role;
ALTER TABLE public.expert_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positions all" ON public.expert_positions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Content outputs
CREATE TABLE public.content_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('article','telegram_post','shorts_script','email','speech_theses')),
  generated_text TEXT,
  edited_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','published','archived')),
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_outputs TO authenticated;
GRANT ALL ON public.content_outputs TO service_role;
ALTER TABLE public.content_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outputs all" ON public.content_outputs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Style templates & knowledge base
CREATE TABLE public.style_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'template' CHECK (kind IN ('template','postulate','aphorism','golden_sample')),
  prompt_body TEXT,
  rules_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.style_templates TO authenticated;
GRANT ALL ON public.style_templates TO service_role;
ALTER TABLE public.style_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "styles all" ON public.style_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_content_outputs_updated_at BEFORE UPDATE ON public.content_outputs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
