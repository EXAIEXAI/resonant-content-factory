// Стилистический промт + фрагменты книг (Гагин, Асланов, Никонов) для эссе.
export async function essayKnowledgeBlock(supabase: any, query: string): Promise<string> {
  const [{ data: style }, { data: chunks }] = await Promise.all([
    supabase
      .from("style_templates")
      .select("name, prompt_body")
      .eq("kind", "prompt")
      .eq("purpose", "essay_style")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("search_book_chunks", { q: query.slice(0, 1500), per_book: 2 }),
  ]);
  let list = (chunks ?? []) as Array<{ book: string; author: string; content: string }>;
  if (list.length === 0) {
    const { data } = await supabase.from("kb_book_chunks").select("book, author, content").in("seq", [5, 40]).limit(6);
    list = data ?? [];
  }
  const books = list
    .map(c => `— ${c.author}, «${c.book}»:\n${c.content.slice(0, 1800)}`)
    .join("\n\n");
  return `${style?.prompt_body ? `Стилистический промт «${style.name}» (обязателен):\n${style.prompt_body}\n\n` : ""}${
    books ? `Фрагменты книг-ориентиров из базы знаний (используй как образец манеры, логики и примеров; не копируй дословно и не выдавай за мысли спикера):\n${books}\n` : ""
  }`;
}
