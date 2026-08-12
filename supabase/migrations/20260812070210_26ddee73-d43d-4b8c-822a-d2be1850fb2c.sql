-- Единое рабочее пространство: все пользователи видят одни и те же источники и материалы
UPDATE public.channels SET user_id = 'da5626be-9b3a-435b-a3c6-ecc015c05217';
UPDATE public.raw_materials SET user_id = 'da5626be-9b3a-435b-a3c6-ecc015c05217';

DROP POLICY IF EXISTS "own channels" ON public.channels;
CREATE POLICY "shared channels" ON public.channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "own materials" ON public.raw_materials;
CREATE POLICY "shared materials" ON public.raw_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_materials TO authenticated;
GRANT ALL ON public.channels TO service_role;
GRANT ALL ON public.raw_materials TO service_role;