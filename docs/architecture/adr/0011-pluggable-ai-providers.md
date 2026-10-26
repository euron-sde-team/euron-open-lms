# ADR 0011: Pluggable AI providers, a stub, and a no-AI mode

## Status

Accepted.

## Context

The AI helps staff: draft quiz questions from a lecture's text, suggest rubric scores and
feedback for a submission, polish a course description or subtitle. Operators differ:
some have an OpenAI key, some prefer Gemini, some cannot send learner work to any model
provider. Tests and local development need deterministic output with no key. Model output
is untrusted: it can be malformed, wrong or steered by text inside a submission.

## Decision

- One port, [`integrations/ai/provider.ts`](../../../apps/api/src/integrations/ai/provider.ts):
  `json({ name, schema, system, user })`, returning raw JSON and usage.
- `AI_PROVIDER` selects ([`integrations/ai/index.ts`](../../../apps/api/src/integrations/ai/index.ts)):
  `openai` (default; `OPENAI_BASE_URL`, `OPENAI_MODEL` default `gpt-4o-mini`, any
  OpenAI-compatible server), `gemini` (`GEMINI_MODEL` default `gemini-2.5-flash`), `stub`
  (the OpenAI client pointed at [`apps/stubs`](../../../apps/stubs/README.md), deterministic,
  with a `[[ai:fail]]` marker for error paths; refused in production), or `none`.
- `aiAvailable()` is false for `none` and for a real provider without a usable key (unset or
  the Terraform placeholder `set-me`). `GET /api/meta` then reports the AI flags off, the
  web app hides the buttons, and the routes answer `503 AI_UNAVAILABLE`. Everything works by
  hand.
- The tasks own trust ([`integrations/ai/tasks.ts`](../../../apps/api/src/integrations/ai/tasks.ts)):
  strict JSON schemas, input clamped (30000 characters of lesson or submission text),
  learner text fenced and labelled as data with an instruction to ignore instructions
  inside it, and sanitisers that keep only well-formed output (at most 20 drafted
  questions, scores clamped per criterion). What comes back is a draft
  ([ADR 0017](0017-ai-drafts-never-auto-applied.md)).
- Calls are rate limited per user (30 per hour for authoring, 30 per hour for grading).

## Consequences

Positive:

- A deployment runs with OpenAI, Gemini or no AI, by configuration only.
- The same client code runs in tests against the stub.

Trade-offs:

- Two adapters to keep in step with the schemas.
- The operator decides, and must tell staff, that lesson text and submissions go to a
  third-party model when a real provider is configured.

## Alternatives considered

- **One hard-wired vendor.** No keyless mode and no choice.
- **Trusting structured output as-is.** Schemas constrain shape, not truth.
