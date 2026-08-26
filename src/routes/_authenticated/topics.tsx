import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb } from "lucide-react";
import { CreateTopicDialog } from "@/components/CreateTopicDialog";

export const Route = createFileRoute("/_authenticated/topics")({
  head: () => ({
    meta: [
      { title: "Темы роликов · Контент-завод" },
      { name: "description", content: "Темы будущих роликов: подбор материалов, эссе и сценарии." },
      { property: "og:title", content: "Темы роликов · Контент-завод" },
      { property: "og:description", content: "Темы будущих роликов: подбор материалов, эссе и сценарии." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TopicsPage,
});

export const topicStatusLabels: Record<string, string> = {
  draft: "Новая",
  materials_selected: "Ролики утверждены",
  angles_ready: "10 тем предложены",
  angle_chosen: "Тема выбрана",
  essay_draft: "Эссе на редактуре",
  essay_ready: "Эссе подтверждено",
  script_draft: "Сценарий на редактуре",
  done: "Сценарий готов",
};

function TopicsPage() {
  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: async () =>
      (await supabase.from("topics").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Темы роликов</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            От идеи до сценария: подбор роликов, эссе по промту, сценарий
          </p>
        </div>
        <CreateTopicDialog />
      </div>

      <div className="space-y-3">
        {(topics ?? []).map(t => (
          <Link key={t.id} to="/topics/$id" params={{ id: t.id }} className="block">
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.chosen_angle ?? t.title}</div>
                  {t.chosen_angle && t.chosen_angle !== t.title && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">Общая тема: {t.title}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(t.created_at).toLocaleDateString("ru-RU")} · роликов: {(t.selected_material_ids ?? []).length}
                  </div>
                </div>
                <Badge variant={t.status === "done" ? "default" : "secondary"} className="shrink-0">
                  {topicStatusLabels[t.status] ?? t.status}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
        {(topics ?? []).length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Lightbulb className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Тем пока нет. Нажмите «Создать тему ролика», чтобы начать.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
