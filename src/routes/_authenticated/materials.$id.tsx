import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import { ArrowLeft, MessageSquare, ThumbsUp, ThumbsDown, HelpCircle, Quote, ExternalLink, Trash2 } from "lucide-react";
import { analyzeMaterial, generateContent } from "@/lib/ai.functions";
import { formatTimecode as formatTC } from "@/lib/youtube";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/materials/$id")({
  head: () => ({ meta: [{ title: "Редакционная карточка · Контент-завод" }] }),
  component: MaterialPage,
});

const reactionIcons: Record<string, any> = {
  agree: ThumbsUp, disagree: ThumbsDown, question: HelpCircle, comment: MessageSquare, aphorism: Quote,
};

function MaterialPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeMaterial);
  const generate = useServerFn(generateContent);

  const { data: m } = useQuery({
    queryKey: ["material", id],
    queryFn: async () => (await supabase.from("raw_materials").select("*, channels(title, category)").eq("id", id).maybeSingle()).data,
  });

  const { data: positions } = useQuery({
    queryKey: ["positions", id],
    queryFn: async () => (await supabase.from("expert_positions").select("*").eq("material_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: outputs } = useQuery({
    queryKey: ["outputs", id],
    queryFn: async () => (await supabase.from("content_outputs").select("*").eq("material_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const [pos, setPos] = useState({ reaction_type: "comment", transcript: "", linked_thesis: "", timecode: "" });

  const addPosition = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("expert_positions").insert({
        ...pos,
        material_id: id,
        expert_id: u.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Позиция эксперта сохранена");
      qc.invalidateQueries({ queryKey: ["positions", id] });
      setPos({ reaction_type: "comment", transcript: "", linked_thesis: "", timecode: "" });
      supabase.from("raw_materials").update({ status: "in_production" }).eq("id", id).then(() => qc.invalidateQueries({ queryKey: ["material", id] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runAnalyze = useMutation({
    mutationFn: () => analyze({ data: { materialId: id } }),
    onSuccess: () => { toast.success("Анализ готов"); qc.invalidateQueries({ queryKey: ["material", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runGenerate = useMutation({
    mutationFn: (format: string) => generate({ data: { materialId: id, format: format as any } }),
    onSuccess: () => { toast.success("Контент сгенерирован"); qc.invalidateQueries({ queryKey: ["outputs", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!m) return <div className="text-muted-foreground">Загрузка...</div>;

  const keyPoints = Array.isArray(m.key_points) ? m.key_points as any[] : [];

  return (
    <div className="space-y-6">
      <Link to="/radar" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> К радару
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex gap-2 mb-2">
            <Badge variant="outline">Score {(m.engagement_score ?? 0).toFixed(2)}</Badge>
            <Badge>{m.status}</Badge>
          </div>
          <h1 className="font-serif text-3xl">{m.title}</h1>
        </div>
        {m.url && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href={m.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />Открыть оригинал
            </a>
          </Button>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Блок А: Источник */}
        <Card className="border-l-4 border-l-muted-foreground/30">
          <CardHeader>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Блок А — Источник</div>
            <CardTitle className="font-serif">Факты автора</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!m.summary && (
              <Button size="sm" onClick={() => runAnalyze.mutate()} disabled={runAnalyze.isPending}>
                {runAnalyze.isPending ? "Анализирую..." : "Проанализировать (Gemini)"}
              </Button>
            )}
            {m.summary && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Краткая выжимка</div>
                <p className="text-sm">{m.summary}</p>
              </div>
            )}
            {keyPoints.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2">Ключевые тезисы</div>
                <ul className="space-y-2">
                  {keyPoints.map((p, i) => (
                    <li key={i} className="text-sm border-l-2 border-muted pl-3">
                      {p.timecode && <span className="text-xs text-primary mr-2">{p.timecode}</span>}
                      <span className="font-medium">{p.thesis}</span>
                      {p.quote && <div className="text-muted-foreground italic mt-1">«{p.quote}»</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(m.transcript_segments) && m.transcript_segments.length > 0 && (
              <details className="text-xs" open>
                <summary className="cursor-pointer text-muted-foreground">Транскрипт с таймкодами ({m.transcript_segments.length})</summary>
                <div className="mt-2 max-h-80 overflow-auto space-y-1">
                  {(m.transcript_segments as any[]).map((s, i) => {
                    const tc = formatTC(s.start);
                    const link = m.external_id ? `https://www.youtube.com/watch?v=${m.external_id}&t=${Math.floor(s.start)}s` : null;
                    return (
                      <div key={i} className="flex gap-2">
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="font-mono text-primary shrink-0 w-14">{tc}</a>
                        ) : (
                          <span className="font-mono text-muted-foreground shrink-0 w-14">{tc}</span>
                        )}
                        <span>{s.text}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {m.raw_transcript && (!Array.isArray(m.transcript_segments) || m.transcript_segments.length === 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Полный транскрипт</summary>
                <div className="mt-2 whitespace-pre-wrap text-muted-foreground max-h-64 overflow-auto">{m.raw_transcript}</div>
              </details>
            )}
          </CardContent>
        </Card>

        {/* Блок Б: Эксперт */}
        <Card className="border-l-4 border-l-accent">
          <CardHeader>
            <div className="text-xs uppercase tracking-wide text-accent-foreground mb-1">Блок Б — Позиция эксперта</div>
            <CardTitle className="font-serif">Мнение · Аргументы · Кейсы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Реакция</Label>
                  <Select value={pos.reaction_type} onValueChange={v => setPos({ ...pos, reaction_type: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agree">Согласие</SelectItem>
                      <SelectItem value="disagree">Возражение</SelectItem>
                      <SelectItem value="question">Открытый вопрос</SelectItem>
                      <SelectItem value="comment">Комментарий</SelectItem>
                      <SelectItem value="aphorism">Афоризм</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Таймкод (опц.)</Label>
                  <input className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" placeholder="00:12:30" value={pos.timecode} onChange={e => setPos({ ...pos, timecode: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">К какому тезису</Label>
                <input className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={pos.linked_thesis} onChange={e => setPos({ ...pos, linked_thesis: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Комментарий / расшифровка голоса</Label>
                <Textarea rows={4} value={pos.transcript} onChange={e => setPos({ ...pos, transcript: e.target.value })} placeholder="Ваш аргумент, кейс, пример компании..." />
              </div>
              <Button size="sm" onClick={() => addPosition.mutate()} disabled={!pos.transcript || addPosition.isPending}>Сохранить позицию</Button>
            </div>

            <div className="space-y-2">
              {(positions ?? []).map(p => {
                const Icon = reactionIcons[p.reaction_type ?? "comment"] ?? MessageSquare;
                return (
                  <div key={p.id} className="p-3 border rounded-md">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <Icon className="w-3 h-3" /> {p.reaction_type}
                      {p.timecode && <span>· {p.timecode}</span>}
                    </div>
                    {p.linked_thesis && <div className="text-xs italic text-muted-foreground mb-1">к: {p.linked_thesis}</div>}
                    <div className="text-sm">{p.transcript}</div>
                  </div>
                );
              })}
              {positions?.length === 0 && <p className="text-xs text-muted-foreground">Позиции ещё не зафиксированы.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Генерация контента */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Производство контента</CardTitle>
          <p className="text-sm text-muted-foreground">Единый контекст: источник + анализ + позиция эксперта + стилевой профиль</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              ["article", "Статья"],
              ["telegram_post", "Telegram-пост"],
              ["shorts_script", "Сценарий Shorts"],
              ["email", "Email"],
              ["speech_theses", "Тезисы выступления"],
            ].map(([f, label]) => (
              <Button key={f} variant="outline" size="sm" onClick={() => runGenerate.mutate(f)} disabled={runGenerate.isPending}>
                {label}
              </Button>
            ))}
          </div>
          <Tabs defaultValue={outputs?.[0]?.id}>
            <TabsList className="flex-wrap h-auto">
              {(outputs ?? []).map(o => (
                <TabsTrigger key={o.id} value={o.id}>{o.format} · v{o.version}</TabsTrigger>
              ))}
            </TabsList>
            {(outputs ?? []).map(o => (
              <TabsContent key={o.id} value={o.id}>
                <OutputEditor output={o} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function OutputEditor({ output }: { output: any }) {
  const qc = useQueryClient();
  const [text, setText] = useState<string>(output.edited_text ?? output.generated_text ?? "");
  const [status, setStatus] = useState<string>(output.status);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("content_outputs").update({ edited_text: text, status }).eq("id", output.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Сохранено"); qc.invalidateQueries({ queryKey: ["outputs", output.material_id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("content_outputs").delete().eq("id", output.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Удалено"); qc.invalidateQueries({ queryKey: ["outputs", output.material_id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3 mt-3">
      <Textarea rows={16} value={text} onChange={e => setText(e.target.value)} className="font-mono text-sm" />
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="review">На согласовании</SelectItem>
            <SelectItem value="approved">Одобрено</SelectItem>
            <SelectItem value="published">Опубликовано</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={() => { if (confirm("Удалить этот файл?")) remove.mutate(); }}
          disabled={remove.isPending}
          className="ml-auto"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
