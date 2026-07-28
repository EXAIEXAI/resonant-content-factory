// Client-side text extraction from uploaded files.
// Supports: .txt, .md, .csv, .json, .html and .pdf (via pdfjs-dist).

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  // Any text-like file
  const text = await file.text();
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    return doc.body?.innerText ?? text;
  }
  return text;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Use the bundled worker via URL import so Vite serves it correctly.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: unknown) => (it as { str?: string }).str ?? "").join(" ") + "\n\n";
  }
  return out.trim();
}
