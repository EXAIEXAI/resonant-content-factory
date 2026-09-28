CREATE TABLE public.kb_book_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book text NOT NULL,
  author text NOT NULL,
  seq int NOT NULL,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_book_chunks TO authenticated;
GRANT ALL ON public.kb_book_chunks TO service_role;
ALTER TABLE public.kb_book_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read books" ON public.kb_book_chunks FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage books" ON public.kb_book_chunks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX kb_book_chunks_tsv ON public.kb_book_chunks USING gin(tsv);

CREATE OR REPLACE FUNCTION public.search_book_chunks(q text, per_book int DEFAULT 2)
RETURNS TABLE(book text, author text, content text, rank real)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT book, author, content, rank FROM (
    SELECT c.book, c.author, c.content,
      ts_rank(c.tsv, websearch_to_tsquery('russian', q)) AS rank,
      row_number() OVER (PARTITION BY c.book ORDER BY ts_rank(c.tsv, websearch_to_tsquery('russian', q)) DESC) rn
    FROM kb_book_chunks c
    WHERE c.tsv @@ to_tsquery('russian', array_to_string(tsvector_to_array(to_tsvector('russian', q)), ' | '))
  ) s WHERE rn <= per_book ORDER BY rank DESC;
$$;
GRANT EXECUTE ON FUNCTION public.search_book_chunks(text, int) TO authenticated;