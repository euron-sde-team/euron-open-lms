/**
 * Gemini provider: generateContent with a response schema. Text in, JSON out; nothing
 * is uploaded to a provider-side file store, so nothing is left there afterwards.
 */
import type { AiProvider, AiUsage } from "./provider";

const TIMEOUT_MS = 90_000;

/** Gemini's schema dialect: no additionalProperties, nullable instead of type unions. */
export function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "maxLength") continue;
    if (k === "type" && Array.isArray(v)) {
      out.type = String(v.find((t) => t !== "null")).toUpperCase();
      out.nullable = v.includes("null");
    } else if (k === "type") out.type = String(v).toUpperCase();
    else if (k === "enum" && Array.isArray(v)) out.enum = v.filter((x) => x !== null);
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function geminiProvider(endpoint: () => Endpoint): AiProvider {
  return {
    name: "gemini",
    async json(task): Promise<{ raw: unknown; usage: AiUsage }> {
      const e = endpoint();
      const res = await fetch(`${e.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(e.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": e.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: task.system }] },
          contents: [{ role: "user", parts: [{ text: task.user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: toGeminiSchema(task.schema) },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`AI provider answered ${res.status}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) throw new Error("The AI returned nothing");
      return { raw: JSON.parse(text), usage: { model: e.model, tokensIn: body.usageMetadata?.promptTokenCount ?? 0, tokensOut: body.usageMetadata?.candidatesTokenCount ?? 0 } };
    },
  };
}
