import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaterialCard } from "@/components/MaterialCard";
import { computeScore } from "@/lib/scoring";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { addBriefingVideo } from "@/lib/quickflow.functions";
import { BRIEFING_PLAYLIST_ID } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/briefing/")({
  head: () => ({
    meta: [
      { title: "Недавно сохранённое · Контент-завод" },
      { name: "description", content: "Недавно сохранённые ролики: описание, эссе и сценарий в три шага." },
      { property: "og:title", content: "Недавно сохранённое · Контент-завод" },
      { property: "og:description", content: "Недавно сохранённые ролики: описание, эссе и сценарий в три шага." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BriefingPage,
});

function BriefingPage() {
  const { data: materials } = useQuery({
    queryKey: ["materials-briefing", BRIEFING_PLAYLIST_ID],
    queryFn: async () =>
      (await supabase
        .from("raw_materials")
        .select("*")
        .eq("source_type", "youtube_saved")
        .eq("playlist_id", BRIEFING_PLAYLIST_ID)
        .order("created_at", { ascending: false })).data ?? [],
  });

  const list = useMemo(
    () =>
      (materials ?? []).map(m => {
        const { score, factors } = computeScore({ ...m, subscribers: 1000 });
        return { ...m, computedScore: score, factors };
      }),
    [materials],
  );

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl">Недавно сохранённое</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Ролики из плейлиста «Контент-Завод». Нажмите «Разобрать» — получите описание, затем эссе и сценарий.
        </p>
      </div>

      <div className="space-y-3">
        {list.map(m => (
          <div key={m.id} className="space-y-1">
            {m.playlist_label && (
              <Badge variant="outline" className="text-xs">{m.playlist_label}</Badge>
            )}
            <MaterialCard
              m={m}
              actions={
                <Button size="sm" asChild>
                  <Link to="/briefing/$id" params={{ id: m.id }}>Разобрать</Link>
                </Button>
              }
            />
          </div>
        ))}
        {list.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              Пока пусто. Сохраняйте ролики в YouTube-плейлист «Контент-Завод» — они появятся здесь автоматически.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
