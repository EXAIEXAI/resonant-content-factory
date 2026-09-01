import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { Sparkles, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { suggestMaterials, saveTopicMaterials, generateAngles, chooseAngle, generateTopicEssay, generateTopicScript } from "@/lib/topics.functions";
import { topicStatusLabels } from "@/routes/_authenticated/topics";

/** Воронка темы: подбор роликов из дайджеста → 10 углов → эссе → сценарий. */
export function TopicFlow({ id }: { id: string }) {
  const qc = useQueryClient();
  const suggest = useServerFn(suggestMaterials);
  const saveMaterials = useServerFn(saveTopicMaterials);
  const genAngles = useServerFn(generateAngles);
  const pickAngle = useServerFn(chooseAngle);
  const genEssay = useServerFn(generateTopicEssay);
  const genScript = useServerFn(generateTopicScript);

  const { data: topic } = useQuery({
    queryKey: ["topic", id],
    queryFn: async () => (await supabase.from("topics").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: selectedMaterials } = useQuery({
    queryKey: ["topic-materials", id, (topic?.selected_material_ids ?? []).join(",")],
    enabled: !!topic,
    queryFn: async () => {
      const ids: string[] = topic?.selected_material_ids ?? [];
      if (!ids.length) return [];
      return (await supabase.from("raw_materials").select("id, title, channel_title, thumbnail_url").in("id", ids)).data ?? [];
    },
  });

  const { data: prompts } = useQuery({
    queryKey: ["styles-prompts"],
    queryFn: async () =>
      (await supabase.from("style_templates").select("id, name").eq("kind", "prompt").order("created_at", { ascending: false })).data ?? [],
  });

  const { data: outputs } = useQuery({
    queryKey: ["topic-outputs", id],
    queryFn: async () =>
      (await supabase.from("content_outputs").select("*").eq("topic_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  // Шаг 1: подбор роликов
  const [suggested, setSuggested] = useState<any[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const runSuggest = useMutation({
    mutationFn: () => suggest({ data: { topicId: id } }),
    onSuccess: (r) => {
      setSuggested(r.suggestions);
      setChecked(new Set(r.suggestions.map((s: any) => s.id)));
      if (r.suggestions.length === 0) toast.info("Подходящих роликов в дайджесте не нашлось — добавьте вручную");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runSearch = async () => {
    if (search.trim().length < 2) return;
    const { data } = await supabase
      .from("raw_materials")
      .select("id, title, channel_title")
      .ilike("title", `%${search.trim()}%`)
      .limit(10);
    setSearchResults(data ?? []);
  };

  const addManual = (m: any) => {
    if (manual.some(x => x.id === m.id) || checked.has(m.id)) return;
    setManual(prev => [...prev, m]);
    setChecked(prev => new Set(prev).add(m.id));
  };

  const allCandidates = useMemo(() => [...(suggested ?? []), ...manual], [suggested, manual]);

  const approve = useMutation({
    mutationFn: () => saveMaterials({ data: { topicId: id, materialIds: Array.from(checked) } }),
    onSuccess: () => {
      toast.success("Ролики утверждены");
      qc.invalidateQueries({ queryKey: ["topic", id] });
      qc.invalidateQueries({ queryKey: ["topic-materials", id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Шаг 2: 10 тем
  const [customAngle, setCustomAngle] = useState("");
  const [selectedAngle, setSelectedAngle] = useState<string>("");

  const runAngles = useMutation({
    mutationFn: () => genAngles({ data: { topicId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["topic", id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmAngle = useMutation({
    mutationFn: (angle: string) => pickAngle({ data: { topicId: id, angle } }),
    onSuccess: () => {
      toast.success("Тема выбрана — можно генерировать эссе");
      qc.invalidateQueries({ queryKey: ["topic", id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Шаг 3: эссе (промт по умолчанию или выбранный)
  const [essayPromptId, setEssayPromptId] = useState("auto");
  const runEssay = useMutation({
    mutationFn: () => genEssay({ data: { topicId: id, promptId: essayPromptId === "auto" ? null : essayPromptId } }),
    onSuccess: () => {
      toast.success("Эссе сгенерировано");
      qc.invalidateQueries({ queryKey: ["topic-outputs", id] });
      qc.invalidateQueries({ queryKey: ["topic", id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Шаг 4: сценарий
  const [scriptPromptId, setScriptPromptId] = useState("none");
  const runScript = useMutation({
    mutationFn: () => genScript({ data: { topicId: id, promptId: scriptPromptId === "none" ? null : scriptPromptId } }),
    onSuccess: () => {
      toast.success("Сценарий сгенерирован");
      qc.invalidateQueries({ queryKey: ["topic-outputs", id] });
      qc.invalidateQueries({ queryKey: ["topic", id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!topic) return <div className="text-muted-foreground py-8 text-center">Загрузка...</div>;

  const angles: string[] = Array.isArray(topic.angles) ? (topic.angles as string[]) : [];
  const essayOutputs = (outputs ?? []).filter(o => o.format === "essay");
  const scriptOutputs = (outputs ?? []).filter(o => o.format === "script");
  const confirmedEssay = essayOutputs.find(o => o.status === "ready");
  const step = topic.status === "draft" ? 1
    : ["materials_selected", "angles_ready"].includes(topic.status) ? 2
    : ["angle_chosen", "essay_draft"].includes(topic.status) ? 3 : 4;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex gap-2 mb-2 flex-wrap">
          <Badge>{topicStatusLabels[topic.status] ?? topic.status}</Badge>
          <Badge variant="outline">Шаг {step} из 4</Badge>
        </div>
        <h2 className="font-serif text-xl sm:text-2xl">{topic.chosen_angle ?? topic.title}</h2>
        {topic.chosen_angle && <p className="text-sm text-muted-foreground mt-1">Общая тема: {topic.title}</p>}
      </div>

      {/* Шаг 1 — подбор роликов */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="font-serif">1. Подбор роликов</CardTitle>
            <p className="text-sm text-muted-foreground">Подходящие ролики из дайджеста — отметьте нужные или добавьте вручную</p>
          </div>
          {topic.status === "draft" && (
            <Button size="sm" onClick={() => runSuggest.mutate()} disabled={runSuggest.isPending}>
              <Sparkles className="w-4 h-4 mr-2" />
              {runSuggest.isPending ? "Подбираю..." : suggested ? "Подобрать заново" : "Подобрать ролики"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {topic.status === "draft" ? (
            <>
              {allCandidates.length > 0 && (
                <div className="space-y-2">
                  {allCandidates.map(m => (
                    <label key={m.id} className="flex items-center gap-3 p-2 border rounded-md cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={checked.has(m.id)}
                        onCheckedChange={(v) => {
                          setChecked(prev => {
                            const next = new Set(prev);
                            if (v) next.add(m.id); else next.delete(m.id);
                            return next;
                          });
                        }}
                      />
                      {m.thumbnail_url && <img src={m.thumbnail_url} alt="" className="w-16 aspect-video rounded object-cover" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium line-clamp-2">{m.title}</div>
                        {m.channel_title && <div className="text-xs text-muted-foreground">{m.channel_title}</div>}
                      </div>
                      {manual.some(x => x.id === m.id) && <Badge variant="outline" className="ml-auto shrink-0">вручную</Badge>}
                    </label>
                  ))}
                </div>
              )}
              <div className="border rounded-md p-3 space-y-2 bg-muted/20">
                <Label className="text-xs">Добавить ролик вручную (поиск по названию)</Label>
                <div className="flex gap-2">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Начните вводить название..." onKeyDown={e => { if (e.key === "Enter") runSearch(); }} />
                  <Button variant="outline" onClick={runSearch}>Найти</Button>
                </div>
                {searchResults.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-2 text-sm border-t pt-2">
                    <span className="truncate">{m.title}</span>
                    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => addManual(m)}><Plus className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>
              {(suggested !== null || manual.length > 0) && (
                <Button onClick={() => approve.mutate()} disabled={checked.size === 0 || approve.isPending}>
                  <Check className="w-4 h-4 mr-2" />
                  {approve.isPending ? "Сохраняю..." : `Утвердить (${checked.size})`}
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {(selectedMaterials ?? []).map(m => (
                <div key={m.id} className="flex items-center gap-3 p-2 border rounded-md">
                  {m.thumbnail_url && <img src={m.thumbnail_url} alt="" className="w-16 aspect-video rounded object-cover" />}
                  <Link to="/materials/$id" params={{ id: m.id }} className="text-sm hover:text-primary line-clamp-2">{m.title}</Link>
                </div>
              ))}
              {(selectedMaterials ?? []).length === 0 && <p className="text-sm text-muted-foreground">Ролики не выбраны.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Шаг 2 — 10 уточняющих тем */}
      {step >= 2 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="font-serif">2. Выбор темы</CardTitle>
              <p className="text-sm text-muted-foreground">10 вариантов от контент-завода — или напишите свою</p>
            </div>
            {!topic.chosen_angle && (
              <Button size="sm" onClick={() => runAngles.mutate()} disabled={runAngles.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {runAngles.isPending ? "Думаю..." : angles.length ? "Предложить заново" : "Предложить 10 тем"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {topic.chosen_angle ? (
              <div className="flex items-center gap-2 p-3 border rounded-md bg-primary/5">
                <Check className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium">{topic.chosen_angle}</span>
              </div>
            ) : (
              <>
                {angles.map((a, i) => (
                  <label key={i} className="flex items-center gap-3 p-2 border rounded-md cursor-pointer hover:bg-muted/40">
                    <input type="radio" name="angle" className="accent-primary" checked={selectedAngle === a} onChange={() => setSelectedAngle(a)} />
                    <span className="text-sm">{a}</span>
                  </label>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={customAngle}
                    onChange={e => { setCustomAngle(e.target.value); if (e.target.value) setSelectedAngle(""); }}
                    placeholder="Или напишите свою тему..."
                  />
                </div>
                <Button
                  onClick={() => confirmAngle.mutate(customAngle.trim() || selectedAngle)}
                  disabled={(!customAngle.trim() && !selectedAngle) || confirmAngle.isPending}
                >
                  {confirmAngle.isPending ? "Сохраняю..." : "Выбрать тему"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Шаг 3 — эссе */}
      {step >= 3 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="font-serif">3. Эссе</CardTitle>
              <p className="text-sm text-muted-foreground">Генерация по описаниям выбранных роликов и промту из базы знаний</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="min-w-[220px]">
                <Label className="text-xs">Промт для эссе</Label>
                <Select value={essayPromptId} onValueChange={setEssayPromptId}>
                  <SelectTrigger><SelectValue placeholder="По умолчанию" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">По умолчанию</SelectItem>
                    {(prompts ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => runEssay.mutate()} disabled={runEssay.isPending}>

                <Sparkles className="w-4 h-4 mr-2" />
                {runEssay.isPending ? "Пишу эссе..." : essayOutputs.length ? "Сгенерировать заново" : "Сгенерировать эссе"}
              </Button>
            </div>
            {essayOutputs.map(o => (
              <TopicOutputEditor key={o.id} output={o} topicId={id} confirmLabel="Подтвердить эссе" confirmTopicStatus="essay_ready" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Шаг 4 — сценарий */}
      {confirmedEssay && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif">4. Сценарий</CardTitle>
            <p className="text-sm text-muted-foreground">Генерируется на основании подтверждённого эссе и промта из базы знаний</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="min-w-[220px]">
                <Label className="text-xs">Промт для сценария</Label>
                <Select value={scriptPromptId} onValueChange={setScriptPromptId}>
                  <SelectTrigger><SelectValue placeholder="Без промта" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без промта</SelectItem>
                    {(prompts ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => runScript.mutate()} disabled={runScript.isPending}>
                <Sparkles className="w-4 h-4 mr-2" />
                {runScript.isPending ? "Пишу сценарий..." : scriptOutputs.length ? "Сгенерировать заново" : "Сгенерировать сценарий"}
              </Button>
            </div>
            {scriptOutputs.map(o => (
              <TopicOutputEditor key={o.id} output={o} topicId={id} confirmLabel="Подтвердить сценарий" confirmTopicStatus="done" />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TopicOutputEditor({ output, topicId, confirmLabel, confirmTopicStatus }: {
  output: any; topicId: string; confirmLabel: string; confirmTopicStatus: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState(output.edited_text ?? output.generated_text ?? "");
  const confirmed = output.status === "ready";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("content_outputs").update({ edited_text: text }).eq("id", output.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Текст сохранён");
      qc.invalidateQueries({ queryKey: ["topic-outputs", topicId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase.from("content_outputs").update({ edited_text: text, status: "ready" }).eq("id", output.id);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from("topics").update({ status: confirmTopicStatus, updated_at: new Date().toISOString() }).eq("id", topicId);
      if (e2) throw new Error(e2.message);
    },
    onSuccess: () => {
      toast.success("Подтверждено");
      qc.invalidateQueries({ queryKey: ["topic-outputs", topicId] });
      qc.invalidateQueries({ queryKey: ["topic", topicId] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unconfirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("content_outputs").update({ status: "draft" }).eq("id", output.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topic-outputs", topicId] });
      qc.invalidateQueries({ queryKey: ["topic", topicId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant={confirmed ? "default" : "secondary"}>{confirmed ? "Подтверждено" : "Черновик"}</Badge>
          <span className="text-xs text-muted-foreground">{new Date(output.created_at).toLocaleString("ru-RU")}</span>
        </div>
        <div className="flex gap-2">
          {confirmed ? (
            <Button size="sm" variant="ghost" onClick={() => unconfirm.mutate()} disabled={unconfirm.isPending}>
              <X className="w-4 h-4 mr-1" /> Вернуть в черновики
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Сохраняю..." : "Сохранить правки"}
              </Button>
              <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                <Check className="w-4 h-4 mr-1" /> {confirm.isPending ? "..." : confirmLabel}
              </Button>
            </>
          )}
        </div>
      </div>
      <Textarea rows={16} value={text} onChange={e => setText(e.target.value)} disabled={confirmed} className="text-sm leading-relaxed" />
    </div>
  );
}
