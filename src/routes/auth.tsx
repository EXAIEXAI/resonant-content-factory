import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import logoAsset from "@/assets/logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const translate = (msg: string) => {
    const m = msg.toLowerCase();
    if (m.includes("weak") || m.includes("pwned")) return "Этот пароль найден в утечках данных. Придумайте другой, посложнее.";
    if (m.includes("already registered") || m.includes("user already")) return "Пользователь с таким email уже зарегистрирован. Войдите во вкладке «Вход».";
    if (m.includes("invalid login")) return "Неверный email или пароль.";
    if (m.includes("password should be at least")) return "Пароль должен быть не короче 6 символов.";
    if (m.includes("invalid email") || m.includes("unable to validate email")) return "Некорректный email.";
    if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток. Попробуйте через несколько минут.";
    return msg;
  };

  const signIn = async () => {
    setError(null);
    if (!email || !password) return setError("Заполните email и пароль.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { const t = translate(error.message); setError(t); toast.error(t); return; }
    navigate({ to: "/" });
  };

  const signUp = async () => {
    setError(null);
    if (!email || !password) return setError("Заполните email и пароль.");
    if (password.length < 6) return setError("Пароль должен быть не короче 6 символов.");
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
    if (error) { const t = translate(error.message); setError(t); toast.error(t); return; }
    toast.success("Аккаунт создан.");
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden">
            <img src={logoAsset.url} alt="Контент-завод" className="w-10 h-10 object-contain" />
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
