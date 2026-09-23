import { createFileRoute, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { getSharedSession } from "@/lib/guest-auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };

    // Вход не требуется: молча открываем общий рабочий аккаунт.
    const session = await getSharedSession();
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    const { data: after } = await supabase.auth.getUser();
    return { user: after.user };
  },
  component: () => (
    <AppShell><Outlet /></AppShell>
  ),
});
