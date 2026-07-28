import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useRef, useState } from "react";
import { Plus, Trash2, Upload, Pencil } from "lucide-react";
import { toast } from "sonner";
import { processKnowledgeFile } from "@/lib/ai.functions";
import { extractTextFromFile } from "@/lib/extract-text";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "База знаний · Контент-завод" }] }),
  component: KnowledgePage,
});

const kinds: Record<string, string> = {
  postulate: "33 постулата",
  aphorism: "Афоризмы",
  golden_sample: "Образцы статей",
  template: "Шаблоны стиля",
};

type Item = { id: string; name: string; kind: string; prompt_body: string | null };

function KnowledgePage() {
  const qc = useQueryClient();
  const process = useServerFn(processKnowledgeFile);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: items } = useQuery({
    queryKey: ["styles"],
    queryFn: async () =>
      ((await supabase.from("style_templates").select("*").order("created_at", { ascending: false })).data ?? []) as Item[],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "postulate", prompt_body: "" });
  const [uploadKind, setUploadKind] = useState<string>("postulate");
  const [editing, setEditing] = useState<Item | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("style_templates").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Добавлено"); qc.invalidateQueries({ queryKey: ["styles"] }); setOpen(false); setForm({ name: "", kind: "postulate", prompt_body: "" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async (i: Item) => {
      const { error } = await supabase.from("style_templates")
        .update({ name: i.name, kind: i.kind, prompt_body: i.prompt_body })
        .eq("id", i.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Сохранено"); qc.invalidateQueries({ queryKey: ["styles"] }); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await supabase.from("style_templates").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["styles"] }),
  });

  const upload = useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind: string }) => {
      const text = await extractTextFromFile(file);
      if (!text || text.length < 10) throw new Error("Не удалось извлечь текст из файла");
      return process({ data: { filename: file.name, text, kind: kind as "postulate" | "aphorism" | "golden_sample" | "template" } });
    },
    onSuccess: (r) => { toast.success(`Добавлено записей: ${r.inserted}`); qc.invalidateQueries({ queryKey: ["styles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await upload.mutateAsync({ file: f, kind: uploadKind });
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-4xl">База знаний</h1>
          <p className="text-muted-foreground mt-1">Постулаты, афоризмы и образцы стиля — фундамент RAG</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={uploadKind} onValueChange={setUploadKind}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".txt,.md,.csv,.json,.html,.htm,.pdf,text/plain,text/markdown,text/csv,application/json,text/html,application/pdf"
            className="hidden"
            onChange={e => onPickFiles(e.target.files)}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            <Upload className="w-4 h-4 mr-2" />{upload.isPending ? "Обработка…" : "Загрузить файлы"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Добавить</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-serif">Новая запись</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Название</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Тип</Label>
                  <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Содержание</Label><Textarea rows={6} value={form.prompt_body} onChange={e => setForm({ ...form, prompt_body: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Сохранить</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-xs text-muted-foreground -mt-3">
        Загружаемые файлы (TXT, MD, CSV, JSON, HTML, PDF) обрабатываются ИИ и раскладываются на записи выбранного типа.
      </p>

      <Tabs defaultValue="postulate">
        <TabsList>{Object.entries(kinds).map(([k, v]) => <TabsTrigger key={k} value={k}>{v}</TabsTrigger>)}</TabsList>
        {Object.keys(kinds).map(k => (
          <TabsContent key={k} value={k} className="space-y-3 mt-4">
            {(items ?? []).filter(i => i.kind === k).map(i => (
              <Card key={i.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{i.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(i)} aria-label="Редактировать"><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(i.id)} aria-label="Удалить"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </CardHeader>
                <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{i.prompt_body}</p></CardContent>
              </Card>
            ))}
            {(items ?? []).filter(i => i.kind === k).length === 0 && (
              <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Пока пусто</CardContent></Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-serif">Редактировать запись</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Название</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Тип</Label>
                <Select value={editing.kind} onValueChange={v => setEditing({ ...editing, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(kinds).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Содержание</Label><Textarea rows={8} value={editing.prompt_body ?? ""} onChange={e => setEditing({ ...editing, prompt_body: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={() => editing && update.mutate(editing)} disabled={update.isPending}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
