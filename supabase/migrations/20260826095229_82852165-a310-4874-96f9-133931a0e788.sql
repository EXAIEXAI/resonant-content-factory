ALTER TABLE public.content_outputs DROP CONSTRAINT content_outputs_format_check;
ALTER TABLE public.content_outputs ADD CONSTRAINT content_outputs_format_check
  CHECK (format IN ('article','telegram_post','shorts_script','email','speech_theses','essay','script'));

ALTER TABLE public.content_outputs DROP CONSTRAINT content_outputs_status_check;
ALTER TABLE public.content_outputs ADD CONSTRAINT content_outputs_status_check
  CHECK (status IN ('draft','review','approved','published','archived','ready'));