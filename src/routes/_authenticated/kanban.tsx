import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContentCalendar } from "@/components/ContentCalendar";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({
    meta: [
      { title: "Канбан и календарь · Контент-завод" },
      { name: "description", content: "Канбан публикаций и контент-план по месяцам с перетаскиванием тем." },
      { property: "og:title", content: "Канбан и календарь · Контент-завод" },
      { property: "og:description", content: "Канбан публикаций и контент-план по месяцам с перетаскиванием тем." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
  const { data: materials } = useQuery({
    queryKey: ["materials-kanban"],
    queryFn: async () => (await supabase.from("raw_materials").select("id, title, status, category, engagement_score")).data ?? [],
  });

  // Synchronized top scrollbar
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncing = useRef(false);

  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom) return;
    const update = () => setScrollWidth(bottom.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, [materials]);

  const sync = (from: "top" | "bottom") => () => {
    if (syncing.current) return;
    syncing.current = true;
    const top = topRef.current, bottom = bottomRef.current;
    if (top && bottom) {
      if (from === "top") bottom.scrollLeft = top.scrollLeft;
      else top.scrollLeft = bottom.scrollLeft;
    }
    syncing.current = false;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Канбан / Календарь</h1>
        <p className="text-muted-foreground mt-1">Жизненный цикл материала и контент-план публикаций</p>
      </div>

      <Tabs defaultValue="kanban" className="space-y-4">
        <TabsList>
          <TabsTrigger value="kanban">Канбан</TabsTrigger>
          <TabsTrigger value="calendar">Календарь</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="space-y-4">
      <div
        ref={topRef}
        onScroll={sync("top")}
        className="overflow-x-auto overflow-y-hidden h-4"
        aria-hidden
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      <div ref={bottomRef} onScroll={sync("bottom")} className="flex gap-3 overflow-x-auto pb-4">
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
