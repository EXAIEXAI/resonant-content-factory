import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
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

  const [pick, setPick] = useState<{ userId?: string; role?: string }>({});

  const assign = useMutation({
    mutationFn: async () => {
      if (!pick.userId || !pick.role) return;
      const { error } = await supabase.from("user_roles").insert({ user_id: pick.userId, role: pick.role as any });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Роль назначена"); qc.invalidateQueries({ queryKey: ["roles-all"] }); },
    onError: (e: Error) => toast.error(e.message + " (нужны права администратора)"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles-all"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const byUser = new Map<string, any[]>();
  (roles ?? []).forEach(r => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Роли и права</h1>
        <p className="text-muted-foreground mt-1">RBAC: Владелец продукта, Эксперт, Редактор, Администратор</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">Назначить роль</CardTitle></CardHeader>
        <CardContent className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <Select value={pick.userId} onValueChange={v => setPick({ ...pick, userId: v })}>
              <SelectTrigger><SelectValue placeholder="Пользователь" /></SelectTrigger>
              <SelectContent>{(profiles ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Select value={pick.role} onValueChange={v => setPick({ ...pick, role: v })}>
              <SelectTrigger><SelectValue placeholder="Роль" /></SelectTrigger>
              <SelectContent>{Object.entries(roleLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => assign.mutate()} disabled={!pick.userId || !pick.role}>Назначить</Button>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {(profiles ?? []).map(p => (
          <Card key={p.id}>
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{p.full_name || p.email}</div>
                <div className="text-xs text-muted-foreground">{p.email}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(byUser.get(p.id) ?? []).map(r => (
                  <Badge key={r.id} variant="secondary" className="cursor-pointer" onClick={() => remove.mutate(r.id)}>
                    {roleLabels[r.role]} ×
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
