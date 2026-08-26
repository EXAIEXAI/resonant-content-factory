CREATE TABLE public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  selected_material_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  angles jsonb NOT NULL DEFAULT '[]'::jsonb,
  chosen_angle text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topics shared ALL" ON public.topics FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.content_outputs ADD COLUMN topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL;