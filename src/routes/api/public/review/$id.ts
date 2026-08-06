// Публичная HTML-страница с разбором видео — открывается по кнопке «Читать обзор» в Telegram.
import { createFileRoute } from "@tanstack/react-router";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length, 4);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      out.push("<hr/>");
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function page(title: string, bodyHtml: string, meta: string): string {
  return `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--fg:#1b2330;--muted:#5b6777;--accent:#2E9CCA;--primary:#1A3E59;--line:#e3e8ee}
*{box-sizing:border-box}
body{margin:0;background:#f6f8fa;color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 18px 64px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 22px}
.meta{color:var(--muted);font-size:14px;margin:0 0 18px}
h1{font-size:24px;line-height:1.25;margin:0 0 12px;color:var(--primary)}
h2{font-size:19px;margin:28px 0 8px;color:var(--primary)}
h3{font-size:16px;margin:20px 0 6px;color:var(--accent)}
p{margin:8px 0}
ul,ol{padding-left:22px;margin:8px 0}
li{margin:5px 0}
blockquote{border-left:3px solid var(--accent);margin:10px 0;padding:2px 0 2px 12px;color:var(--muted);font-style:italic}
hr{border:none;border-top:1px solid var(--line);margin:24px 0}
a{color:var(--accent)}
</style></head><body><div class="wrap"><div class="card">
<p class="meta">${meta}</p>
${bodyHtml}
</div></div></body></html>`;
}

export const Route = createFileRoute("/api/public/review/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: m } = await db
          .from("raw_materials")
          .select("id, title, channel_title, url, summary, review_md")
          .eq("id", params.id)
          .maybeSingle();

        if (!m) {
          return new Response(page("Разбор не найден", "<h1>Разбор не найден</h1>", ""), {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        let review: string | null = m.review_md;
        if (!review) {
          try {
            const { generateReviewById } = await import("@/lib/review.server");
            review = await generateReviewById(supabaseAdmin as never, m.id, { force: false });
          } catch (e) {
            console.error("public review generate failed", m.id, e);
          }
        }

        const meta =
          [m.channel_title ? esc(m.channel_title) : null, m.url ? `<a href="${esc(m.url)}">Смотреть видео</a>` : null]
            .filter(Boolean)
            .join(" · ") || "&nbsp;";

        const body = review
          ? mdToHtml(review)
          : `<h1>${esc(m.title ?? "Разбор видео")}</h1>` +
            (m.summary ? `<p>${esc(m.summary)}</p>` : "") +
            `<p>Развёрнутый разбор ещё формируется. Обновите страницу через несколько минут.</p>`;

        return new Response(page(m.title ?? "Разбор видео", body, meta), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
