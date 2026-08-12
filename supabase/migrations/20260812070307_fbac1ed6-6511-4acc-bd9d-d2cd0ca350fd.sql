DROP POLICY IF EXISTS "own integration settings" ON public.integration_settings;
CREATE POLICY "shared integration settings" ON public.integration_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_settings TO authenticated;
GRANT ALL ON public.integration_settings TO service_role;