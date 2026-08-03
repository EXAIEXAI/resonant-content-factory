import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { Sparkles, ExternalLink, Crown, FileText, ChevronDown, Eye, ThumbsUp, MessageSquare, Bookmark } from "lucide-react";
import type { ScoreFactor } from "@/lib/scoring";

export function formatRaw(key: ScoreFactor["key"], raw: number): string {
  switch (key) {
    case "views": return raw.toLocaleString("ru-RU");
    case "reach": return `${(raw * 100).toFixed(1)}% подписчиков`;
    case "engagement": return `${(raw * 100).toFixed(2)}% от просмотров`;
    case "velocity": return `${raw.toFixed(1)} просм/час`;
    case "recency": return `${raw.toFixed(1)} дн. назад`;
  }
}

export function getOriginalUrl(m: { external_id?: string | null; url?: string | null }): string | null {
  if (m.external_id && /^[a-zA-Z0-9_-]{11}$/.test(m.external_id)) {
    return `https://www.youtube.com/watch?v=${m.external_id}`;
  }
  if (m.url && /^https?:\/\//i.test(m.url)) return m.url;
  return null;
}

export function MaterialCard({ m }: { m: any }) {
  const fromPlaylist = m.source_type === "youtube_playlist";
  const saved = m.source_type === "youtube_saved";
  const [open, setOpen] = useState(false);
  const factors: ScoreFactor[] = m.factors ?? [];
  const topFactor = factors.slice().sort((a, b) => b.contribution - a.contribution)[0];
  const originalUrl = getOriginalUrl(m);
  return (
    <Card>
      <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 sm:gap-4 space-y-0">
        {m.thumbnail_url && originalUrl ? (
          <a
            href={originalUrl}
            target="_top"
            rel="noopener noreferrer"
            className="shrink-0 block w-24 sm:w-40 aspect-video rounded-md overflow-hidden bg-muted"
          >
            <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          </a>
        ) : <span />}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {m.rank ? <Badge variant="secondary">#{m.rank}</Badge> : null}
            {saved && <Badge className="bg-accent text-accent-foreground"><Bookmark className="w-3 h-3 mr-1" />Из плейлиста</Badge>}
            {fromPlaylist && <Badge className="bg-primary text-primary-foreground"><Crown className="w-3 h-3 mr-1" />Из плейлиста</Badge>}
            {m.is_manual && !fromPlaylist && !saved && <Badge variant="outline" className="border-accent text-accent-foreground bg-accent/20"><Sparkles className="w-3 h-3 mr-1" />Ручной</Badge>}
            {m.channel_title && <span className="text-xs text-muted-foreground truncate max-w-[160px]">· {m.channel_title}</span>}
            {!m.channel_title && m.channel?.title && <span className="text-xs text-muted-foreground truncate max-w-[160px]">· {m.channel.title}</span>}
          </div>
          <CardTitle className="text-sm sm:text-base leading-snug break-words">
            <Link to="/materials/$id" params={{ id: m.id }} className="hover:text-primary">{m.title}</Link>
          </CardTitle>
          {m.summary && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-2 leading-relaxed line-clamp-3">{m.summary}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-serif text-xl sm:text-2xl text-primary whitespace-nowrap">{Math.round(m.computedScore ?? m.engagement_score ?? 0)}<span className="text-xs sm:text-sm text-muted-foreground">/100</span></div>
          <div className="text-xs text-muted-foreground">Рейтинг</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
          <div className="flex gap-4 flex-wrap text-muted-foreground">
            <span className="flex items-center gap-1"><Eye className="w-4 h-4" />{(m.views ?? 0).toLocaleString("ru-RU")}</span>
            <span className="flex items-center gap-1"><ThumbsUp className="w-4 h-4" />{(m.reactions ?? 0).toLocaleString("ru-RU")}</span>
            <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4" />{(m.comments_count ?? 0).toLocaleString("ru-RU")}</span>
          </div>
          <div className="flex items-center gap-2">
            {m.drive_file_url && (
              <a
                href={m.drive_file_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border hover:bg-accent hover:text-accent-foreground"
              >
                <FileText className="w-3 h-3" />Диск
              </a>
            )}
            {originalUrl && (
              <a
                href={originalUrl}
                target="_top"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />Открыть оригинал
              </a>
            )}
          </div>
        </div>

        {factors.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-xs text-primary hover:underline">
                <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
                {open ? "Скрыть объяснение рейтинга" : "Почему такая позиция?"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                {m.rank && (
                  <div className="text-xs text-muted-foreground">
                    Позиция <span className="font-medium text-foreground">#{m.rank}</span> из {m.total}.
                    {topFactor && <> Наибольший вклад — <span className="font-medium text-foreground">{topFactor.label.toLowerCase()}</span> (+{Math.round(topFactor.contribution * 100)} баллов).</>}
                  </div>
                )}
                <div className="space-y-2">
                  {factors.map(f => (
                    <div key={f.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="font-medium">{f.label}</span>
                          <span className="text-muted-foreground"> · вес {(f.weight * 100).toFixed(0)}% · {formatRaw(f.key, f.raw)}</span>
                        </div>
                        <span className="font-mono">+{Math.round(f.contribution * 100)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.round(f.normalized * 100)}%` }} />
                      </div>
                      <div className="text-[11px] text-muted-foreground">{f.description}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-sm">
                  <span className="text-muted-foreground">Итоговый рейтинг</span>
                  <span className="font-serif text-lg text-primary">{Math.round(m.computedScore ?? 0)} / 100</span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
