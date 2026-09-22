import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Распознавание речи не настроено" }, { status: 500 });
        }
        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof File) || file.size < 2048) {
          return Response.json({ error: "Запись пустая — попробуйте ещё раз" }, { status: 400 });
        }
        if (file.size > 14 * 1024 * 1024) {
          return Response.json({ error: "Запись слишком длинная — сократите её" }, { status: 400 });
        }

        const form = new FormData();
        form.append("model", "google/gemini-3.5-transcribe");
        form.append("file", file, file.name || "recording.wav");
        form.append("response_format", "json");
        form.append("language", "ru");

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });

        if (!res.ok) {
          const detail = await res.text();
          console.error("transcription failed", res.status, detail);
          const message =
            res.status === 402
              ? "Закончились кредиты ИИ — пополните баланс"
              : res.status === 429
                ? "Слишком много запросов, попробуйте через минуту"
                : "Не удалось распознать речь";
          return Response.json({ error: message }, { status: res.status });
        }

        const data = (await res.json()) as { text?: string };
        return Response.json({ text: (data.text ?? "").trim() });
      },
    },
  },
});
