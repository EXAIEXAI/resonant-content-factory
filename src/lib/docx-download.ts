import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

/** Скачивает текст как .docx файл. */
export async function downloadTextAsDocx(title: string, body: string, fileName: string) {
  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...body.split(/\n+/).map(
      line =>
        new Paragraph({
          children: [new TextRun({ text: line.trim() })],
          spacing: { after: 160 },
        }),
    ),
  ];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".docx") ? fileName : `${fileName}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
