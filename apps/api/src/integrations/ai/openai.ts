/**
 * OpenAI-compatible provider (chat completions with strict JSON schemas). Used against
 * api.openai.com in production and against apps/stubs in tests and local development,
 * so both run the same client code.
 */
import type { AiProvider, AiUsage } from "./provider";

const TIMEOUT_MS = 90_000;

interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export function openAiCompatible(name: string, endpoint: () => Endpoint): AiProvider {
  return {
    name,
    async json(task): Promise<{ raw: unknown; usage: AiUsage }> {
      const e = endpoint();
      const res = await fetch(`${e.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {}) },
        body: JSON.stringify({
          model: e.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: task.system },
            { role: "user", content: task.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: task.name, strict: true, schema: task.schema } },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const msg = body.choices?.[0]?.message;
      if (!msg?.content) throw new Error(msg?.refusal ? "The AI declined this input" : "The AI returned nothing");
      return { raw: JSON.parse(msg.content), usage: { model: e.model, tokensIn: body.usage?.prompt_tokens ?? 0, tokensOut: body.usage?.completion_tokens ?? 0 } };
    },
  };
}
