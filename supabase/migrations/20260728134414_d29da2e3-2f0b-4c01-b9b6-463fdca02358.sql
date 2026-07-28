DROP INDEX IF EXISTS public.raw_materials_external_id_key;
ALTER TABLE public.raw_materials ADD CONSTRAINT raw_materials_external_id_key UNIQUE (external_id);