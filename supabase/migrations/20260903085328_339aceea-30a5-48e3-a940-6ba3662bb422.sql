ALTER TABLE public.style_templates ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'general';
ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS chapters jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.style_templates SET purpose = 'essay' WHERE kind = 'prompt' AND purpose = 'general' AND name ILIKE '%эссе%';
UPDATE public.style_templates SET purpose = 'script' WHERE kind = 'prompt' AND purpose = 'general' AND (name ILIKE '%сценар%' OR name ILIKE '%script%');