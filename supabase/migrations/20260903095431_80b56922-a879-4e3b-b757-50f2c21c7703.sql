CREATE TABLE public.content_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plan TO authenticated;
GRANT ALL ON public.content_plan TO service_role;

ALTER TABLE public.content_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content plan shared" ON public.content_plan FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER content_plan_updated_at BEFORE UPDATE ON public.content_plan
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX content_plan_date_idx ON public.content_plan(plan_date);