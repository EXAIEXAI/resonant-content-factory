const GATEWAY = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-5";

/** Единая точка вызова LLM: OpenRouter, модель Claude Sonnet 5. */
export async function callLLMRaw(
  system: string,
  user: string,
  opts?: { json?: boolean },
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY отсутствует");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://resonant-content-factory.lovable.app",
      "X-Title": "Content Factory",
    },
    body: JSON.stringify({
      model: MODEL,
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    if (r.status === 429) throw new Error("Превышен лимит запросов к ИИ. Попробуйте позже.");
    if (r.status === 402) throw new Error("Закончились средства на балансе OpenRouter. Пополните счёт.");
    if (r.status === 401) throw new Error("Неверный ключ OpenRouter. Проверьте настройки.");
    throw new Error(`Ошибка ИИ (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

export async function callLLM(system: string, user: string): Promise<string> {
  return callLLMRaw(system, user);
}

export function parseJsonLoose<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\n?|\n?```$/g, "").trim());
  } catch {
    return fallback;
  }
}
