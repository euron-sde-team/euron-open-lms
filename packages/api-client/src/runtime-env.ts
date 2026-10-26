/**
 * Runtime configuration hand-off, server to browser. One image ships to every
 * environment, so the web app serves `/env.js` from its own environment at
 * request time and loads it before any client code.
 */

/**
 * Serialise config as a script that assigns `globalThis.__LMS_ENV`.
 * Escaping `<` and U+2028/U+2029 keeps any string value inert inside a script.
 */
export function envScript(env: object): string {
  const json = JSON.stringify(env)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `globalThis.__LMS_ENV = Object.freeze(${json});\n`;
}

export function envScriptResponse(env: object): Response {
  return new Response(envScript(env), {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
  });
}

/** A trimmed non-empty string, or undefined. */
export const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
