/**
 * The AI provider port: one call, "answer this as JSON matching that schema". The LMS
 * tasks (tasks.ts) build the prompt and schema and sanitise what comes back, so a
 * provider can never write unchecked data anywhere; everything it returns is a draft a
 * person accepts.
 */
export interface AiUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  name: string;
  json(task: { name: string; schema: object; system: string; user: string }): Promise<{ raw: unknown; usage: AiUsage }>;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI is not configured on this server") {
    super(message);
  }
}
