/**
 * Generate docs/api/openapi.yaml from the route files, so the reference can never drift
 * from the code: every endpoint, its guards and its doc comment come from the source.
 *
 *   pnpm openapi          regenerate
 *   pnpm openapi --check  exit 1 if docs/api/openapi.yaml is out of date (CI)
 *
 * What it reads:
 *   apps/api/src/routes/index.ts   the MOUNTS table, one `["/api/x", router],` per line,
 *                                  and `import { router as x } from "./x.routes";`
 *   apps/api/src/routes/*.ts       `router.<method>("<path>", ...guards, ctrl.fn);`
 *                                  with an optional /** doc *\/ right above, and
 *                                  `router.use(guard)` lines that apply to every route
 *                                  declared after them
 *
 * Guards: authenticate = bearer token required; optionalAuth = bearer token optional;
 * requireRole("ADMIN", ...) = described as the roles required. Rate limits and other
 * middleware are ignored. Request and response bodies are described in the doc
 * comments; the typed contract lives in packages/types.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const ROUTES = path.join(ROOT, "apps", "api", "src", "routes");
const OUT = path.join(ROOT, "docs", "api", "openapi.yaml");

type Auth = "required" | "optional" | "none";
type Op = { method: string; path: string; summary: string; roles: string[]; auth: Auth; tag: string; operationId: string };

const index = fs.readFileSync(path.join(ROUTES, "index.ts"), "utf8");
const files = new Map<string, string>();
for (const m of index.matchAll(/import \{\s*router as (\w+)\s*\} from "\.\/([\w.-]+)";/g)) files.set(m[1], m[2]);

const mounts: { prefix: string; ident: string }[] = [];
for (const m of index.matchAll(/^\s*\["(\/[^"]*)",\s*(\w+)\s*\],?\s*$/gm)) {
  if (files.has(m[2])) mounts.push({ prefix: m[1], ident: m[2] });
}
if (!mounts.length) throw new Error("no MOUNTS found in apps/api/src/routes/index.ts");

/** Split a call's argument list on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Fold a guard into the running access state. */
function applyGuard(g: string, consts: Map<string, string>, state: { auth: Auth; roles: string[] }): void {
  const expr = consts.get(g) ?? g;
  if (expr === "authenticate") state.auth = "required";
  else if (expr === "optionalAuth") {
    if (state.auth === "none") state.auth = "optional";
  } else {
    const role = expr.match(/^requireRole\(([^)]*)\)$/);
    if (role) {
      state.auth = "required";
      state.roles = role[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
    }
  }
}

/** Doc comment directly above line i (single or multi-line), flattened. */
function docAbove(lines: string[], i: number): string {
  let j = i - 1;
  if (j < 0 || !lines[j].trim().endsWith("*/")) return "";
  const buf: string[] = [];
  for (; j >= 0; j--) {
    buf.unshift(lines[j]);
    if (lines[j].trim().startsWith("/**")) break;
  }
  return buf
    .join("\n")
    .replace(/\/\*\*|\*\//g, "")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const tagDescriptions = new Map<string, string>();
const ops: Op[] = [];

for (const { prefix, ident } of mounts) {
  const text = fs.readFileSync(path.join(ROUTES, files.get(ident)! + ".ts"), "utf8");
  const tag = prefix.replace(/^\/api\/?/, "") || "root";

  // The file's leading doc comment ("/** /api/x: what it is. */") describes the tag.
  const header = (text.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] ?? "").replace(/^\s*\*\s?/gm, "").trim().split(/\n\s*\n/)[0] ?? "";
  const headerText = header.replace(/\s+/g, " ").replace(/^\/api\/?\S*:\s*/, "").trim();
  if (headerText && !/^\(scaffold/.test(headerText)) tagDescriptions.set(tag, headerText);

  // Named guards: const staff = requireRole("ADMIN", "MODERATOR");
  const consts = new Map<string, string>();
  for (const c of text.matchAll(/const (\w+) = (requireRole\([^)]*\)|authenticate|optionalAuth);/g)) consts.set(c[1], c[2]);

  const lines = text.split("\n");
  const state = { auth: "none" as Auth, roles: [] as string[] };
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].match(/^router\.(get|post|put|patch|delete|use)\(/);
    if (!start) continue;
    // Gather the whole statement (it may span lines) up to the closing ");".
    let stmt = lines[i];
    let k = i;
    while (!/\);\s*(\/\/.*)?$/.test(stmt) && k + 1 < lines.length) stmt += " " + lines[++k].trim();
    const argText = stmt.slice(stmt.indexOf("(") + 1, stmt.lastIndexOf(")"));
    const args = splitArgs(argText);

    if (start[1] === "use") {
      for (const g of args) applyGuard(g, consts, state);
      i = k;
      continue;
    }
    const route = args[0]?.match(/^"([^"]+)"$/)?.[1];
    if (!route) {
      i = k;
      continue;
    }
    const handler = args[args.length - 1]?.match(/^\w+\.(\w+)$/)?.[1] ?? `${start[1]}${route.replace(/\W+/g, "_")}`;
    const access = { auth: state.auth, roles: [...state.roles] };
    for (const g of args.slice(1, -1)) applyGuard(g, consts, access);

    // "listTypes" -> "List types": the controller name is the fallback summary.
    const fromHandler = handler
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
    const full = (prefix + (route === "/" ? "" : route)).replace(/\/$/, "") || "/";
    ops.push({
      method: start[1],
      path: full.replace(/:(\w+)/g, "{$1}"),
      summary: docAbove(lines, i) || fromHandler,
      roles: access.roles,
      auth: access.auth,
      tag,
      operationId: `${tag.replace(/[^a-zA-Z0-9]+(.)?/g, (_x, c: string | undefined) => (c ? c.toUpperCase() : ""))}_${handler}`,
    });
    i = k;
  }
}

function y(s: string): string {
  return JSON.stringify(s); // JSON strings are valid YAML scalars
}

const byPath = new Map<string, Op[]>();
for (const op of ops) byPath.set(op.path, [...(byPath.get(op.path) ?? []), op]);

const out: string[] = [];
out.push("# Generated by scripts/gen-openapi.ts from apps/api/src/routes. Do not edit by hand: run `pnpm openapi`.");
out.push("openapi: 3.1.0");
out.push("info:");
out.push("  title: Euron Open LMS API");
out.push("  version: 0.1.0");
out.push("  description: |");
out.push("    REST API of Euron Open LMS. Sign in with POST /api/auth/login to get a short-lived access");
out.push("    token (send it as `Authorization: Bearer <token>`) and an httpOnly refresh cookie that");
out.push("    POST /api/auth/refresh rotates. Webhooks (/api/webhooks/*) take no token: each one verifies");
out.push("    its provider's signature over the raw body (docs/api/webhooks.md).");
out.push("    Errors are `{ \"error\": string, \"code\": string, \"details\"?: unknown, \"requestId\": string }`;");
out.push("    unexpected failures return 500 with a `requestId` and never the underlying message.");
out.push("  license: { name: MIT, identifier: MIT }");
out.push("servers:");
out.push("  - url: http://localhost:3530");
out.push("    description: Local stack (make up), through the web app's proxy");
out.push("  - url: https://{host}");
out.push("    variables: { host: { default: app.example.com } }");
out.push("components:");
out.push("  securitySchemes:");
out.push('    bearer: { type: http, scheme: bearer, bearerFormat: JWT, description: "Access token from POST /api/auth/login or /api/auth/refresh." }');
out.push("  schemas:");
out.push("    Error:");
out.push("      type: object");
out.push("      required: [error]");
out.push("      properties: { error: { type: string }, code: { type: string }, requestId: { type: string } }");
out.push("tags:");
for (const tag of [...new Set(ops.map((o) => o.tag))]) {
  out.push(`  - name: ${y(tag)}`);
  if (tagDescriptions.get(tag)) out.push(`    description: ${y(tagDescriptions.get(tag)!)}`);
}
out.push("paths:");
for (const [p, list] of byPath) {
  out.push(`  ${y(p)}:`);
  for (const op of list) {
    const long = op.summary.length > 120;
    out.push(`    ${op.method}:`);
    out.push(`      tags: [${y(op.tag)}]`);
    out.push(`      operationId: ${y(op.operationId)}`);
    out.push(`      summary: ${y(long ? op.summary.slice(0, 117).replace(/\s+\S*$/, "") + "..." : op.summary)}`);
    const access = op.roles.length ? `Requires role: ${op.roles.join(" or ")}.` : op.auth === "optional" ? "Signed-in callers may see more." : "";
    const desc = [long ? op.summary : "", access].filter(Boolean).join("\n\n");
    if (desc) out.push(`      description: ${y(desc)}`);
    out.push(`      security: ${op.auth === "required" ? "[{ bearer: [] }]" : op.auth === "optional" ? "[{}, { bearer: [] }]" : "[]"}`);
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    if (params.length) {
      out.push("      parameters:");
      for (const name of params) out.push(`        - { name: ${name}, in: path, required: true, schema: { type: string } }`);
    }
    out.push("      responses:");
    out.push('        "2XX": { description: Success }');
    out.push('        "4XX": { description: Client error, content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }');
  }
}
const yaml = out.join("\n") + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== yaml) {
    console.error("docs/api/openapi.yaml is out of date: run `pnpm openapi`");
    process.exit(1);
  }
  console.log(`openapi: up to date (${ops.length} operations)`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, yaml);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${ops.length} operations, ${byPath.size} paths`);
}
