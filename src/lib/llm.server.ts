const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

export async function callLLM(system: string, user: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY отсутствует");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    if (r.status === 429) throw new Error("Превышен лимит запросов к ИИ. Попробуйте позже.");
    if (r.status === 402) throw new Error("Закончились кредиты Lovable AI. Пополните в настройках.");
    throw new Error(`Ошибка ИИ (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export function parseJsonLoose<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\n?|\n?```$/g, "").trim());
  } catch {
    return fallback;
  }
}
