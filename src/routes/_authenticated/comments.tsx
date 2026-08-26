import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { ExternalLink, MessageSquare, ThumbsUp, ThumbsDown, HelpCircle, Quote } from "lucide-react";
import { reactionLabels } from "@/lib/ui-labels";
import { getOriginalUrl } from "@/components/MaterialCard";

export const Route = createFileRoute("/_authenticated/comments")({
  head: () => ({
    meta: [
      { title: "Комментарии экспертов · Контент-завод" },
      { name: "description", content: "Все комментарии экспертов со ссылками на ролики." },
      { property: "og:title", content: "Комментарии экспертов · Контент-завод" },
      { property: "og:description", content: "Все комментарии экспертов со ссылками на ролики." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommentsPage,
});

const reactionIcons: Record<string, any> = {
  agree: ThumbsUp, disagree: ThumbsDown, question: HelpCircle, comment: MessageSquare, aphorism: Quote,
};

function CommentsPage() {
  const [q, setQ] = useState("");
  const [reaction, setReaction] = useState("all");

  const { data: positions } = useQuery({
    queryKey: ["all-positions"],
    queryFn: async () =>
      (await supabase.from("expert_positions").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: materials } = useQuery({
    queryKey: ["materials-lite"],
    queryFn: async () =>
      (await supabase.from("raw_materials").select("id, title, external_id, url, channel_title")).data ?? [],
  });
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });

  const matMap = useMemo(() => new Map((materials ?? []).map(m => [m.id, m])), [materials]);
  const profMap = useMemo(() => new Map((profiles ?? []).map(p => [p.id, p])), [profiles]);

  const filtered = useMemo(() => {
    return (positions ?? []).filter(p => {
      if (reaction !== "all" && p.reaction_type !== reaction) return false;
      if (q.trim()) {
        const hay = `${p.transcript ?? ""} ${p.linked_thesis ?? ""} ${matMap.get(p.material_id)?.title ?? ""}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [positions, reaction, q, matMap]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Комментарии экспертов</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Все зафиксированные позиции со ссылками на ролики · всего: {(positions ?? []).length}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Input
          className="max-w-xs"
          placeholder="Поиск по тексту или ролику..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <Select value={reaction} onValueChange={setReaction}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все реакции</SelectItem>
            {Object.entries(reactionLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {filtered.map(p => {
          const m = matMap.get(p.material_id);
          const author = p.expert_id ? profMap.get(p.expert_id) : null;
          const Icon = reactionIcons[p.reaction_type ?? "comment"] ?? MessageSquare;
          const orig = m ? getOriginalUrl(m) : null;
          return (
            <Card key={p.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <Badge variant="secondary" className="gap-1">
                    <Icon className="w-3 h-3" /> {reactionLabels[p.reaction_type ?? ""] ?? p.reaction_type ?? "—"}
                  </Badge>
                  {p.timecode && <span>· {p.timecode}</span>}
                  <span>· {new Date(p.created_at).toLocaleString("ru-RU")}</span>
                  {author && <span>· {author.full_name ?? author.email}</span>}
                </div>
                {p.linked_thesis && <div className="text-xs italic text-muted-foreground">к тезису: {p.linked_thesis}</div>}
                <div className="text-sm leading-relaxed">{p.transcript}</div>
                {m && (
                  <div className="flex items-center gap-3 pt-1 flex-wrap">
                    <Link to="/materials/$id" params={{ id: m.id }} className="text-xs text-primary hover:underline truncate max-w-[420px]">
                      {m.title}
                    </Link>
                    {orig && (
                      <a href={orig} target="_top" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 shrink-0">
                        <ExternalLink className="w-3 h-3" /> YouTube
                      </a>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Комментарии не найдены.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
