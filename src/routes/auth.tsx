import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Factory } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход · Контент-завод" },
      { name: "description", content: "Вход в платформу «Контент-завод»." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/" });
  };

  const signUp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Аккаунт создан. Проверьте почту для подтверждения.");
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <Factory className="w-6 h-6" />
          </div>
          <div>
            <div className="font-serif text-2xl">Контент-завод</div>
            <div className="text-xs text-muted-foreground">Платформа экспертного контента</div>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="font-serif">Добро пожаловать</CardTitle>
            <CardDescription>Войдите или создайте аккаунт, чтобы начать</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Вход</TabsTrigger>
                <TabsTrigger value="signup">Регистрация</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="space-y-4 mt-4">
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="space-y-2"><Label>Пароль</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
                <Button className="w-full" onClick={signIn} disabled={loading}>Войти</Button>
              </TabsContent>
              <TabsContent value="signup" className="space-y-4 mt-4">
                <div className="space-y-2"><Label>Имя</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
                <div className="space-y-2"><Label>Пароль</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
                <Button className="w-full" onClick={signUp} disabled={loading}>Создать аккаунт</Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
