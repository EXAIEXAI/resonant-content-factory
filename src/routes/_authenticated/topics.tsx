import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lightbulb, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CreateTopicDialog } from "@/components/CreateTopicDialog";
import { TopicFlow } from "@/components/TopicFlow";

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
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: async () =>
      (await supabase.from("topics").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("topics").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Тема удалена");
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askDelete = (t: any) => {
    if (window.confirm(`Удалить тему «${t.chosen_angle ?? t.title}» вместе с эссе и сценариями?`)) {
      if (openTopicId === t.id) setOpenTopicId(null);
      remove.mutate(t.id);
    }
  };

  const openTopic = (topics ?? []).find(t => t.id === openTopicId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Темы роликов</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            От идеи до сценария: подбор роликов из дайджеста, эссе по промту, сценарий
          </p>
        </div>
        <CreateTopicDialog />
      </div>

      <div className="space-y-3">
        {(topics ?? []).map(t => (
          <button key={t.id} type="button" onClick={() => setOpenTopicId(t.id)} className="block w-full text-left">
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
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={t.status === "done" ? "default" : "secondary"}>
                    {topicStatusLabels[t.status] ?? t.status}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Удалить тему"
                    onClick={(e) => { e.stopPropagation(); askDelete(t); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </button>
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

      <Dialog open={!!openTopicId} onOpenChange={(v) => { if (!v) setOpenTopicId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif">{openTopic?.chosen_angle ?? openTopic?.title ?? "Тема ролика"}</DialogTitle>
          </DialogHeader>
          {openTopicId && <TopicFlow key={openTopicId} id={openTopicId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
