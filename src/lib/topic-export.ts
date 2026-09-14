import type { ExportedTopic } from "@/lib/topic-export.functions";
import { topicStatusLabels } from "@/lib/ui-labels-topics";

/** Транслитерация для безопасных имён файлов в архиве. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function slugify(input: string, max = 60): string {
  const s = (input || "topic")
    .toLowerCase()
    .split("")
    .map(ch => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (s || "topic").slice(0, max);
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU") : "—");

export function topicToMarkdown(t: ExportedTopic): string {
  const lines: string[] = [];
  lines.push(`# ${t.chosen_angle ?? t.title}`);
  if (t.chosen_angle && t.chosen_angle !== t.title) lines.push(`**Общая тема:** ${t.title}`);
  lines.push(
    `**Статус:** ${topicStatusLabels[t.status] ?? t.status}  `,
    `**Создана:** ${fmtDate(t.created_at)}  `,
    `**Обновлена:** ${fmtDate(t.updated_at)}`,
    "",
  );

  lines.push("## Ссылки на ролики");
  if (t.materials.length) {
    for (const m of t.materials) {
      const link = m.youtube_url ?? m.url;
      lines.push(`- ${m.title}${m.channel ? ` — ${m.channel}` : ""}${link ? `: ${link}` : ""}`);
    }
  } else lines.push("_Ролики не выбраны_");
  lines.push("");

  if (t.angles.length) {
    lines.push("## Предложенные углы подачи");
    t.angles.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push("");
  }

  lines.push("## Эссе");
  if (t.essays.length) {
    for (const e of t.essays) {
      lines.push(`### Эссе (${e.status}, версия ${e.version}, ${fmtDate(e.created_at)})`, "", e.text, "");
    }
  } else lines.push("_Эссе не создано_", "");

  lines.push("## Сценарии");
  if (t.scripts.length) {
    for (const s of t.scripts) {
      lines.push(`### Сценарий (${s.status}, версия ${s.version}, ${fmtDate(s.created_at)})`, "", s.text, "");
    }
  } else lines.push("_Сценарий не создан_", "");

  if (t.other_outputs.length) {
    lines.push("## Прочие материалы");
    for (const o of t.other_outputs) lines.push(`### ${o.format} (${fmtDate(o.created_at)})`, "", o.text, "");
  }

  if (t.comments.length) {
    lines.push("## Комментарии экспертов");
    for (const c of t.comments) {
      lines.push(
        `- **${c.material_title}**${c.timecode ? ` (${c.timecode})` : ""}${
          c.reaction_type ? ` [${c.reaction_type}]` : ""
        }: ${c.text ?? ""}`,
      );
    }
    lines.push("");
  }

  lines.push("## Промты");
  if (t.prompts.length) {
    for (const p of t.prompts) {
      lines.push(`### ${p.name} (назначение: ${p.purpose})`, "", "```", p.body, "```", "");
    }
  } else lines.push("_Промты не заданы_", "");

  return lines.join("\n");
}

type PdfBlock = { text: string; size: number; bold?: boolean; gap?: number };

function topicToBlocks(t: ExportedTopic): PdfBlock[] {
  const b: PdfBlock[] = [];
  const h1 = (s: string) => b.push({ text: s, size: 18, bold: true, gap: 10 });
  const h2 = (s: string) => b.push({ text: s, size: 13, bold: true, gap: 8 });
  const p = (s: string) => b.push({ text: s, size: 10.5, gap: 4 });

  h1(t.chosen_angle ?? t.title);
  if (t.chosen_angle && t.chosen_angle !== t.title) p(`Общая тема: ${t.title}`);
  p(`Статус: ${topicStatusLabels[t.status] ?? t.status} · создана ${fmtDate(t.created_at)}`);

  h2("Ссылки на ролики");
  if (t.materials.length) {
    for (const m of t.materials) {
      p(`• ${m.title}${m.channel ? ` — ${m.channel}` : ""}`);
      const link = m.youtube_url ?? m.url;
      if (link) p(`   ${link}`);
    }
  } else p("Ролики не выбраны");

  if (t.angles.length) {
    h2("Предложенные углы подачи");
    t.angles.forEach((a, i) => p(`${i + 1}. ${a}`));
  }

  h2("Эссе");
  if (t.essays.length) {
    for (const e of t.essays) {
      b.push({ text: `Версия ${e.version} · ${e.status} · ${fmtDate(e.created_at)}`, size: 10, bold: true, gap: 4 });
      for (const para of e.text.split(/\n{1,}/)) if (para.trim()) p(para.trim());
    }
  } else p("Эссе не создано");

  h2("Сценарии");
  if (t.scripts.length) {
    for (const s of t.scripts) {
      b.push({ text: `Версия ${s.version} · ${s.status} · ${fmtDate(s.created_at)}`, size: 10, bold: true, gap: 4 });
      for (const para of s.text.split(/\n{1,}/)) if (para.trim()) p(para.trim());
    }
  } else p("Сценарий не создан");

  if (t.comments.length) {
    h2("Комментарии экспертов");
    for (const c of t.comments)
      p(`• ${c.material_title}${c.timecode ? ` (${c.timecode})` : ""}: ${c.text ?? ""}`);
  }

  h2("Промты");
  if (t.prompts.length) {
    for (const pr of t.prompts) {
      b.push({ text: `${pr.name} (${pr.purpose})`, size: 11, bold: true, gap: 4 });
      for (const para of (pr.body || "—").split(/\n{1,}/)) if (para.trim()) p(para.trim());
    }
  } else p("Промты не заданы");

  return b;
}

async function renderPdf(blocks: PdfBlock[]): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, fontkitMod] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const fontkit = (fontkitMod as any).default ?? fontkitMod;
  const [regularBytes, boldBytes] = await Promise.all([
    fetch("/fonts/DejaVuSans.ttf").then(r => r.arrayBuffer()),
    fetch("/fonts/DejaVuSans-Bold.ttf").then(r => r.arrayBuffer()),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const W = 595.28, H = 841.89, M = 48, maxW = W - M * 2;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const wrap = (text: string, size: number, font: any): string[] => {
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const probe = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(probe, size) <= maxW) line = probe;
        else {
          if (line) out.push(line);
          if (font.widthOfTextAtSize(word, size) > maxW) {
            let chunk = "";
            for (const ch of word) {
              if (font.widthOfTextAtSize(chunk + ch, size) > maxW) { out.push(chunk); chunk = ch; }
              else chunk += ch;
            }
            line = chunk;
          } else line = word;
        }
      }
      out.push(line);
    }
    return out;
  };

  for (const blk of blocks) {
    const font = blk.bold ? bold : regular;
    const lh = blk.size * 1.42;
    for (const line of wrap(blk.text, blk.size, font)) {
      if (y - lh < M) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(line, { x: M, y: y - blk.size, size: blk.size, font, color: rgb(0.1, 0.13, 0.18) });
      y -= lh;
    }
    y -= blk.gap ?? 4;
  }

  return doc.save();
}

/** Собирает .docx (Word) из тех же блоков, что и PDF. */
async function renderDocx(blocks: PdfBlock[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: blocks.map(
          b =>
            new Paragraph({
              spacing: { after: Math.round((b.gap ?? 4) * 20), before: b.size >= 13 ? 120 : 0 },
              children: [new TextRun({ text: b.text, bold: b.bold, size: Math.round(b.size * 2) })],
            }),
        ),
      },
    ],
  });
  return Packer.toBlob(doc);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Собирает ZIP-архив с PDF, Markdown, JSON и списком ссылок по темам и скачивает его. */
export async function downloadTopicsArchive(topics: ExportedTopic[], archiveName: string) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const stamp = new Date().toISOString().slice(0, 10);

  zip.file("topics.json", JSON.stringify({ exported_at: new Date().toISOString(), topics }, null, 2));

  for (const t of topics) {
    const dir = topics.length > 1 ? `${slugify(t.chosen_angle ?? t.title)}-${t.id.slice(0, 6)}/` : "";
    zip.file(`${dir}topic.md`, topicToMarkdown(t));
    zip.file(`${dir}topic.json`, JSON.stringify(t, null, 2));
    zip.file(`${dir}youtube-links.txt`, (t.youtube_links.length ? t.youtube_links : ["(ссылок нет)"]).join("\n"));
    const blocks = topicToBlocks(t);
    zip.file(`${dir}topic.pdf`, await renderPdf(blocks));
    zip.file(`${dir}topic.docx`, await renderDocx(blocks));
  }

  if (topics.length > 1) {
    const allMd = topics.map(topicToMarkdown).join("\n\n---\n\n");
    zip.file("all-topics.md", allMd);
    const allBlocks: PdfBlock[] = [];
    topics.forEach((t, i) => {
      if (i > 0) allBlocks.push({ text: "———", size: 10, gap: 14 });
      allBlocks.push(...topicToBlocks(t));
    });
    zip.file("all-topics.pdf", await renderPdf(allBlocks));
    zip.file("all-topics.docx", await renderDocx(allBlocks));
    zip.file(
      "all-youtube-links.txt",
      topics
        .map(t => `# ${t.chosen_angle ?? t.title}\n${(t.youtube_links.length ? t.youtube_links : ["(ссылок нет)"]).join("\n")}`)
        .join("\n\n"),
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });
  download(blob, `${archiveName}-${stamp}.zip`);
}
