import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Канбан · Контент-завод" }] }),
  component: KanbanPage,
});

const columns: [string, string][] = [
  ["found", "Найдено"],
  ["in_digest", "В дайджесте"],
  ["awaiting_expert", "Ожидает эксперта"],
  ["in_production", "В производстве"],
  ["review", "Согласование"],
  ["ready", "Готово"],
  ["published", "Опубликовано"],
];

function KanbanPage() {
  const qc = useQueryClient();
  const { data: materials } = useQuery({
    queryKey: ["materials-kanban"],
    queryFn: async () => (await supabase.from("raw_materials").select("id, title, status, category, engagement_score")).data ?? [],
  });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("raw_materials").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Перемещено"); qc.invalidateQueries({ queryKey: ["materials-kanban"] }); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Канбан публикаций</h1>
        <p className="text-muted-foreground mt-1">Жизненный цикл материала — от радара до публикации</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map(([status, label]) => {
          const items = (materials ?? []).filter(m => m.status === status);
          return (
            <div key={status} className="min-w-[260px] w-[260px] shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-sm font-medium">{label}</div>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="space-y-2">
                {items.map(m => (
                  <Card key={m.id} className="p-3">
                    <Link to="/materials/$id" params={{ id: m.id }} className="text-sm font-medium line-clamp-2 hover:text-primary block">{m.title}</Link>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="outline" className="text-xs">{(m.engagement_score ?? 0).toFixed(1)}</Badge>
                    </div>
                  </Card>
                ))}
                {items.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">пусто</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
