ALTER TABLE public.content_outputs DROP CONSTRAINT content_outputs_topic_id_fkey;
ALTER TABLE public.content_outputs ADD CONSTRAINT content_outputs_topic_id_fkey
  FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE;