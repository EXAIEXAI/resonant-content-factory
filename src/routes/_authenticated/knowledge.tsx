import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

function KnowledgePage() {
  const qc = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ["styles"],
    queryFn: async () => (await supabase.from("style_templates").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "postulate", prompt_body: "" });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("style_templates").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Добавлено"); qc.invalidateQueries({ queryKey: ["styles"] }); setOpen(false); setForm({ name: "", kind: "postulate", prompt_body: "" }); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await supabase.from("style_templates").delete().eq("id", id); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["styles"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl">База знаний</h1>
          <p className="text-muted-foreground mt-1">Постулаты, афоризмы и образцы стиля — фундамент RAG</p>
        </div>
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

      <Tabs defaultValue="postulate">
        <TabsList>{Object.entries(kinds).map(([k, v]) => <TabsTrigger key={k} value={k}>{v}</TabsTrigger>)}</TabsList>
        {Object.keys(kinds).map(k => (
          <TabsContent key={k} value={k} className="space-y-3 mt-4">
            {(items ?? []).filter(i => i.kind === k).map(i => (
              <Card key={i.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{i.name}</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => remove.mutate(i.id)}><Trash2 className="w-4 h-4" /></Button>
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
    </div>
  );
}
