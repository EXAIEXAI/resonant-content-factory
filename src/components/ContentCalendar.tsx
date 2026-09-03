import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { GripVertical, X } from "lucide-react";

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Сетка месяца: недели с понедельника, дни соседних месяцев — null. */
function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function ContentCalendar() {
  const qc = useQueryClient();
  const today = new Date();
  const months = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        return { year: d.getFullYear(), month: d.getMonth() };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [monthIdx, setMonthIdx] = useState(0);
  const [dragTopic, setDragTopic] = useState<string | null>(null);
  const [dragEntry, setDragEntry] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: async () =>
      (await supabase.from("topics").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const { data: plan } = useQuery({
    queryKey: ["content-plan"],
    queryFn: async () =>
      (await supabase.from("content_plan").select("id, topic_id, plan_date").order("plan_date")).data ?? [],
  });

  const add = useMutation({
    mutationFn: async (v: { topicId: string; date: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("content_plan")
        .insert({ topic_id: v.topicId, plan_date: v.date, created_by: auth.user?.id ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-plan"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async (v: { id: string; date: string }) => {
      const { error } = await supabase.from("content_plan").update({ plan_date: v.date }).eq("id", v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-plan"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("content_plan").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-plan"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const topicById = new Map((topics ?? []).map(t => [t.id, t]));
  const byDate = new Map<string, { id: string; topic_id: string }[]>();
  for (const p of plan ?? []) {
    const arr = byDate.get(p.plan_date) ?? [];
    arr.push({ id: p.id, topic_id: p.topic_id });
    byDate.set(p.plan_date, arr);
  }

  const current = months[monthIdx];
  const weeks = monthGrid(current.year, current.month);

  const onDrop = (key: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverKey(null);
    if (dragEntry) {
      move.mutate({ id: dragEntry, date: key });
      setDragEntry(null);
    } else if (dragTopic) {
      add.mutate({ topicId: dragTopic, date: key });
      setDragTopic(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit lg:sticky lg:top-4">
        <CardContent className="p-3">
          <div className="text-sm font-medium mb-2">Темы роликов</div>
          <p className="text-xs text-muted-foreground mb-3">Перетащите тему в ячейку календаря</p>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {(topics ?? []).map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={() => { setDragTopic(t.id); setDragEntry(null); }}
                onDragEnd={() => setDragTopic(null)}
                className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs cursor-grab active:cursor-grabbing hover:border-primary/50"
              >
                <GripVertical className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="line-clamp-3">{t.chosen_angle ?? t.title}</span>
              </div>
            ))}
            {(topics ?? []).length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">Тем пока нет</div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap gap-2">
          {months.map((m, i) => (
            <Button
              key={`${m.year}-${m.month}`}
              size="sm"
              variant={i === monthIdx ? "default" : "outline"}
              onClick={() => setMonthIdx(i)}
            >
              {monthNames[m.month]} {m.year}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="p-2 sm:p-3">
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekDays.map(d => (
                <div key={d} className="text-xs text-muted-foreground text-center py-1">{d}</div>
              ))}
            </div>
            <div className="space-y-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((day, di) => {
                    if (!day) return <div key={di} className="min-h-[104px] rounded-md bg-muted/30" />;
                    const key = toKey(day);
                    const items = byDate.get(key) ?? [];
                    const isToday = key === toKey(today);
                    return (
                      <div
                        key={di}
                        onDragOver={(e) => { e.preventDefault(); setOverKey(key); }}
                        onDragLeave={() => setOverKey(k => (k === key ? null : k))}
                        onDrop={onDrop(key)}
                        className={`min-h-[104px] rounded-md border p-1 transition-colors ${
                          overKey === key ? "border-primary bg-primary/5" : "bg-card"
                        }`}
                      >
                        <div className="flex items-center justify-between px-0.5">
                          <span className={`text-xs ${isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                            {day.getDate()}
                          </span>
                          {items.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{items.length}</Badge>}
                        </div>
                        <div className="space-y-1 mt-1">
                          {items.map(it => {
                            const t = topicById.get(it.topic_id);
                            return (
                              <div
                                key={it.id}
                                draggable
                                onDragStart={() => { setDragEntry(it.id); setDragTopic(null); }}
                                onDragEnd={() => setDragEntry(null)}
                                className="group flex items-start gap-1 rounded bg-primary/10 px-1 py-0.5 text-[11px] leading-tight cursor-grab active:cursor-grabbing"
                              >
                                <span className="line-clamp-2 flex-1">{t?.chosen_angle ?? t?.title ?? "Тема"}</span>
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                  title="Убрать из плана"
                                  onClick={() => remove.mutate(it.id)}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
