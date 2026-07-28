import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({ meta: [{ title: "Роли · Контент-завод" }] }),
  component: RolesPage,
});

const roleLabels: Record<string, string> = {
  admin: "Администратор",
  product_owner: "Продуктовик (владелец)",
  expert: "Эксперт",
  editor: "Редактор",
};

function RolesPage() {
  const qc = useQueryClient();
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => (await supabase.from("profiles").select("*")).data ?? [],
  });
  const { data: roles } = useQuery({
    queryKey: ["roles-all"],
    queryFn: async () => (await supabase.from("user_roles").select("*")).data ?? [],
  });

  const change = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Роль обновлена"); qc.invalidateQueries({ queryKey: ["roles-all"] }); },
    onError: (e: Error) => toast.error(e.message + " (нужны права администратора)"),
  });

  const clear = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Роль снята"); qc.invalidateQueries({ queryKey: ["roles-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleByUser = new Map<string, string>();
  (roles ?? []).forEach(r => { roleByUser.set(r.user_id, r.role); });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Роли и права</h1>
        <p className="text-muted-foreground mt-1">У каждого пользователя может быть только одна роль</p>
      </div>

      <div className="grid gap-3">
        {(profiles ?? []).map(p => {
          const current = roleByUser.get(p.id) ?? "";
          return (
            <Card key={p.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium">{p.full_name || p.email}</div>
                  <div className="text-xs text-muted-foreground">{p.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {current && <Badge variant="secondary">{roleLabels[current]}</Badge>}
                  <Select value={current} onValueChange={v => change.mutate({ userId: p.id, role: v })}>
                    <SelectTrigger className="w-[220px]"><SelectValue placeholder="Выбрать роль" /></SelectTrigger>
                    <SelectContent>{Object.entries(roleLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                  {current && <Button variant="ghost" size="sm" onClick={() => clear.mutate(p.id)}>Снять</Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
