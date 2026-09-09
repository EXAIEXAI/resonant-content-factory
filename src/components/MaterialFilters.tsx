import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon, Search, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type { DateRange };

export function useMaterialFilters() {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  return { query, setQuery, range, setRange };
}

/** Search box + date-range picker used on every list of videos/posts. */
export function MaterialFilters({
  query,
  setQuery,
  range,
  setRange,
  placeholder = "Поиск по ключевым словам…",
  className,
}: {
  query: string;
  setQuery: (v: string) => void;
  range: DateRange | undefined;
  setRange: (r: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const label = useMemo(() => {
    if (range?.from && range?.to)
      return `${format(range.from, "d MMM yyyy", { locale: ru })} — ${format(range.to, "d MMM yyyy", { locale: ru })}`;
    if (range?.from) return `с ${format(range.from, "d MMM yyyy", { locale: ru })}`;
    return "Период";
  }, [range]);

  const preset = (days: number) => {
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    setRange({ from, to });
  };

  return (
    <div className={cn("flex flex-col sm:flex-row gap-2", className)}>
      <div className="relative flex-1 min-w-0">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start font-normal", !range?.from && "text-muted-foreground")}>
              <CalendarIcon className="w-4 h-4 mr-2" />
              {label}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              <Button size="sm" variant="secondary" onClick={() => preset(7)}>7 дней</Button>
              <Button size="sm" variant="secondary" onClick={() => preset(30)}>30 дней</Button>
              <Button size="sm" variant="secondary" onClick={() => preset(90)}>3 месяца</Button>
            </div>
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={2}
              locale={ru}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        {(range?.from || query) && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Сбросить фильтры"
            onClick={() => { setRange(undefined); setQuery(""); }}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Filters a list of materials by keyword and by publication/creation date. */
export function filterMaterials<
  T extends {
    title?: string | null;
    summary?: string | null;
    channel_title?: string | null;
    raw_transcript?: string | null;
    playlist_label?: string | null;
    published_at?: string | null;
    created_at?: string | null;
  },
>(list: T[], query: string, range: DateRange | undefined): T[] {
  const q = query.trim().toLowerCase();
  const from = range?.from ? new Date(range.from).setHours(0, 0, 0, 0) : null;
  const to = range?.to ? new Date(range.to).setHours(23, 59, 59, 999) : range?.from ? new Date(range.from).setHours(23, 59, 59, 999) : null;

  return list.filter(m => {
    if (q) {
      const hay = [m.title, m.summary, m.channel_title, m.playlist_label, m.raw_transcript]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (from || to) {
      const raw = m.published_at ?? m.created_at;
      if (!raw) return false;
      const t = new Date(raw).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
    }
    return true;
  });
}
