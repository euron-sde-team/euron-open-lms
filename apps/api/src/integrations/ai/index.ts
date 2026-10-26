/** Which AI provider runs (config.AI_PROVIDER), with a test override. */
import { aiAvailable, config } from "../../core/config";
import { geminiProvider } from "./gemini";
import { openAiCompatible } from "./openai";
import { AiUnavailableError, type AiProvider } from "./provider";

const openai = openAiCompatible("openai", () => ({ baseUrl: config.OPENAI_BASE_URL, apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL }));
const stub = openAiCompatible("stub", () => ({ baseUrl: `${config.AI_STUB_URL.replace(/\/$/, "")}/v1`, model: "stub" }));
const gemini = geminiProvider(() => ({ baseUrl: config.GEMINI_BASE_URL, apiKey: config.GEMINI_API_KEY ?? "", model: config.GEMINI_MODEL }));

let override: AiProvider | null = null;

/** Tests: force a provider (null restores normal selection). */
export function setAiProviderForTests(p: AiProvider | null): void {
  override = p;
}

export function aiProvider(): AiProvider {
  if (override) return override;
  if (!aiAvailable()) throw new AiUnavailableError();
  if (config.AI_PROVIDER === "stub") return stub;
  if (config.AI_PROVIDER === "gemini") return gemini;
  return openai;
}

export { AiUnavailableError, type AiProvider } from "./provider";
