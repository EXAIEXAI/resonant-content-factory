import { useEffect, useRef } from "react";
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
import { generateReview } from "@/lib/review.functions";
import { generateChapters } from "@/lib/chapters.functions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatTimecode as formatTC } from "@/lib/youtube";
import { statusLabels, reactionLabels, formatLabels } from "@/lib/ui-labels";
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
  const [templateId, setTemplateId] = useState<string>("none");
  const [promptId, setPromptId] = useState<string>("none");

  const { data: knowledge } = useQuery({
    queryKey: ["styles"],
    queryFn: async () =>
      (await supabase.from("style_templates").select("id, name, kind").order("created_at", { ascending: false })).data ?? [],
  });
  const templates = (knowledge ?? []).filter(k => k.kind === "template");
  const prompts = (knowledge ?? []).filter(k => k.kind === "prompt");

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
    mutationFn: (format: string) =>
      generate({
        data: {
          materialId: id,
          format: format as any,
          templateId: templateId === "none" ? null : templateId,
          promptId: promptId === "none" ? null : promptId,
        },
      }),
    onSuccess: () => { toast.success("Контент сгенерирован"); qc.invalidateQueries({ queryKey: ["outputs", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const makeReview = useServerFn(generateReview);
  const runReview = useMutation({
    mutationFn: (force: boolean) => makeReview({ data: { materialId: id, force } }),
    onSuccess: () => { toast.success("Разбор готов"); qc.invalidateQueries({ queryKey: ["material", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Разбор по мастер-промту должен быть у каждого ролика, независимо от источника.
  const autoReviewRef = useRef<string | null>(null);
  useEffect(() => {
    if (!m || m.review_md || autoReviewRef.current === id || runReview.isPending) return;
    autoReviewRef.current = id;
    runReview.mutate(false);
  }, [m, id, runReview]);

  if (!m) return <div className="text-muted-foreground">Загрузка...</div>;

  const keyPoints = Array.isArray(m.key_points) ? m.key_points as any[] : [];
  const originalUrl = getOriginalUrl(m);

  return (
    <div className="space-y-6">
      <Link to="/radar" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> К радару
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex gap-2 mb-2">
            <Badge variant="outline">Рейтинг {(m.engagement_score ?? 0).toFixed(0)}</Badge>
            <Badge>{statusLabels[m.status ?? ""] ?? m.status ?? "—"}</Badge>
          </div>
          <h1 className="font-serif text-3xl">{m.title}</h1>
        </div>
        {originalUrl && (
          <a
            href={originalUrl}
            target="_top"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 h-9 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />Открыть оригинал
          </a>
        )}
      </div>

      {/* Разбор видео */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="font-serif">Разбор видео</CardTitle>
            <p className="text-sm text-muted-foreground">
              Смысловые блоки, ключевые мысли, цитаты, вывод и экспертное мнение
            </p>
          </div>
          <Button
            size="sm"
            variant={m.review_md ? "outline" : "default"}
            onClick={() => runReview.mutate(Boolean(m.review_md))}
            disabled={runReview.isPending}
          >
            {runReview.isPending ? "Формирую..." : m.review_md ? "Пересобрать" : "Сформировать разбор"}
          </Button>
        </CardHeader>
        <CardContent>
          {m.review_md ? (
            <article className="prose-review max-w-none text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.review_md}</ReactMarkdown>
            </article>
          ) : (
            <p className="text-sm text-muted-foreground">
              Разбор ещё не сформирован. Он готовится автоматически для сохранённых роликов и доступен по кнопке
              «Читать обзор» в Telegram.
            </p>
          )}
        </CardContent>
      </Card>

      <ChaptersCard material={m} materialId={id} positions={positions ?? []} />

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
                {runAnalyze.isPending ? "Анализирую..." : "Проанализировать"}
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
                      <Icon className="w-3 h-3" /> {reactionLabels[p.reaction_type ?? ""] ?? p.reaction_type ?? "—"}
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
          <p className="text-sm text-muted-foreground">Единый контекст: источник + анализ + комментарии эксперта + шаблон и промт из базы знаний</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Шаблон из базы знаний</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Без шаблона" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без шаблона</SelectItem>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Промт из базы знаний</Label>
              <Select value={promptId} onValueChange={setPromptId}>
                <SelectTrigger><SelectValue placeholder="Без промта" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без промта</SelectItem>
                  {prompts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(templates.length === 0 && prompts.length === 0) && (
            <p className="text-xs text-muted-foreground">
              Шаблоны и промты добавляются в разделе <Link to="/knowledge" className="text-primary underline">База знаний</Link>.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {[
              ["article", "Статья"],
              ["essay", "Эссе"],
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
                <TabsTrigger key={o.id} value={o.id}>{formatLabels[o.format ?? ""] ?? o.format ?? "—"} · в.{o.version}</TabsTrigger>
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

function getOriginalUrl(m: { external_id?: string | null; url?: string | null }): string | null {
  if (m.external_id && /^[a-zA-Z0-9_-]{11}$/.test(m.external_id)) {
    return `https://www.youtube.com/watch?v=${m.external_id}`;
  }
  if (m.url && /^https?:\/\//i.test(m.url)) return m.url;
  return null;
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

type Chapter = { start: number; title: string; summary: string };

/** Таймкоды ролика: суть каждого блока, ссылка на видео со сдвигом и комментарии эксперта. */
function ChaptersCard({ material, materialId, positions }: { material: any; materialId: string; positions: any[] }) {
  const qc = useQueryClient();
  const genChapters = useServerFn(generateChapters);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [text, setText] = useState("");

  const chapters: Chapter[] = Array.isArray(material.chapters) ? (material.chapters as Chapter[]) : [];
  const videoId: string | null =
    material.external_id && /^[a-zA-Z0-9_-]{11}$/.test(material.external_id) ? material.external_id : null;

  const build = useMutation({
    mutationFn: async () => genChapters({ data: { materialId } }),
    onSuccess: () => { toast.success("Таймкоды готовы"); qc.invalidateQueries({ queryKey: ["material", materialId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addComment = useMutation({
    mutationFn: async ({ ch }: { ch: Chapter }) => {
      const { error } = await supabase.from("expert_positions").insert({
        material_id: materialId,
        reaction_type: "comment",
        transcript: text,
        linked_thesis: ch.title,
        timecode: formatTC(ch.start),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Комментарий добавлен");
      setText("");
      setOpenIdx(null);
      qc.invalidateQueries({ queryKey: ["positions", materialId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-serif">Суть по таймкодам</CardTitle>
        <Button
          size="sm"
          variant={chapters.length ? "outline" : "default"}
          onClick={() => build.mutate()}
          disabled={build.isPending}
        >
          {build.isPending ? "Собираю…" : chapters.length ? "Пересобрать" : "Построить таймкоды"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {chapters.length === 0 && (
          <p className="text-sm text-muted-foreground">Таймкоды ещё не построены. Нужен транскрипт с временными метками.</p>
        )}
        {chapters.map((ch, i) => {
          const tc = formatTC(ch.start);
          const chComments = positions.filter(p => p.timecode === tc);
          return (
            <div key={i} className="border rounded-md p-3 space-y-2">
              <div className="flex items-start gap-3">
                {videoId ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(ch.start)}s`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-primary hover:underline pt-0.5 shrink-0"
                  >
                    {tc}
                  </a>
                ) : (
                  <span className="text-xs font-mono text-muted-foreground pt-0.5 shrink-0">{tc}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{ch.title}</div>
                  {ch.summary && <p className="text-sm text-muted-foreground mt-1">{ch.summary}</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                  Комментировать
                </Button>
              </div>
              {chComments.length > 0 && (
                <ul className="space-y-1 pl-1 border-l-2 border-primary/30">
                  {chComments.map(c => (
                    <li key={c.id} className="text-xs text-muted-foreground pl-2">{c.transcript}</li>
                  ))}
                </ul>
              )}
              {openIdx === i && (
                <div className="space-y-2">
                  <Textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Ваш комментарий к этому блоку…" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addComment.mutate({ ch })} disabled={!text.trim() || addComment.isPending}>Сохранить</Button>
                    <Button size="sm" variant="outline" onClick={() => setOpenIdx(null)}>Отмена</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
