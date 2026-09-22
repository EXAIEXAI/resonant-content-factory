import { Link } from "@tanstack/react-router";
import { ChevronRight, Bookmark } from "lucide-react";

function moscowGreeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 18) return "Добрый день";
  if (hour >= 18 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

export function GreetingBanner() {
  return (
    <Link
      to="/briefing"
      className="mb-6 flex items-center gap-4 rounded-xl border border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-4 sm:px-6 transition-colors hover:border-primary/40 hover:from-primary/15"
    >
      <div className="hidden sm:flex w-10 h-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Bookmark className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-lg sm:text-xl truncate">
          {moscowGreeting()}, Фарид!
        </div>
        <div className="text-sm text-muted-foreground truncate">
          Посмотрите, что вы сохранили недавно.
        </div>
      </div>
      <ChevronRight className="w-5 h-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
