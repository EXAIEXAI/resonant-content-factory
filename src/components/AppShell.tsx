import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Radio, Rss, FileStack, Kanban, BookOpen, Users, LogOut, Factory, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard },
  { to: "/channels", label: "Источники", icon: Radio },
  { to: "/radar", label: "Отраслевой радар", icon: Rss },
  { to: "/digests", label: "Дайджесты", icon: FileStack },
  { to: "/kanban", label: "Канбан публикаций", icon: Kanban },
  { to: "/knowledge", label: "База знаний", icon: BookOpen, locked: true },
  { to: "/roles", label: "Роли", icon: Users },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="px-5 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <div className="font-serif text-lg leading-none">Контент-завод</div>
              <div className="text-xs text-sidebar-foreground/60 mt-1">v1.0 · MVP</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(item => {
            const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
            const Icon = item.icon;
            if (item.locked) {
              return (
                <div
                  key={item.to}
                  aria-disabled="true"
                  title="Раздел временно закрыт"
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/40 cursor-not-allowed select-none"
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="w-3.5 h-3.5" />
                </div>
              );
            }
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "hover:bg-sidebar-accent text-sidebar-foreground/80"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" /> Выйти
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
