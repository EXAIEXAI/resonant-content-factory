import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Radio, Rss, FileStack, Kanban, BookOpen, Users, LogOut, Factory, Lock, Plug, Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useEffect, useState, type ReactNode } from "react";

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
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const SidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-md bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
            <Factory className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-serif text-lg leading-none truncate">Контент-завод</div>
            <div className="text-xs text-sidebar-foreground/60 mt-1">v1.0 · MVP</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="lg:hidden -mr-1 p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/80"
          aria-label="Закрыть меню"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
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
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                <Lock className="w-3.5 h-3.5 shrink-0" />
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
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <Link
          to="/integrations"
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
            pathname.startsWith("/integrations")
              ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
              : "hover:bg-sidebar-accent text-sidebar-foreground/80"
          }`}
        >
          <Plug className="w-4 h-4 shrink-0" /> <span className="truncate">Интеграции</span>
        </Link>
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={signOut}>
          <LogOut className="w-4 h-4 mr-2" /> Выйти
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground flex-col border-r border-sidebar-border">
        {SidebarContent}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="relative w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border animate-in slide-in-from-left duration-200">
            {SidebarContent}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-40 flex items-center gap-2 px-4 py-3 bg-background/95 backdrop-blur border-b">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="p-2 -ml-2 rounded-md hover:bg-accent"
            aria-label="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Factory className="w-4 h-4" />
            </div>
            <div className="font-serif text-base truncate">Контент-завод</div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
