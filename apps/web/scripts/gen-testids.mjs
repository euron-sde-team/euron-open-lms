// Regenerates TESTIDS.md from every data-testid in src/. Run: node scripts/gen-testids.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src");
const AREAS = [
  ["components/shell", "Shell and navigation"],
  ["components/common", "Shell and navigation"],
  ["components/home", "Home"],
  ["components/auth", "Sign up and sign in"],
  ["components/catalog", "Catalog"],
  ["components/course", "Course page"],
  ["components/instructor", "Course page"],
  ["components/player", "Video player"],
  ["components/classroom", "Classroom"],
  ["components/my-learning", "My learning"],
  ["components/verify", "Certificates"],
  ["components/plans", "Plans and checkout"],
  ["components/checkout", "Plans and checkout"],
  ["components/account", "Account center"],
  ["components/notifications", "Notifications"],
  ["components/admin", "Admin"],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const groups = new Map();
for (const file of walk(src)) {
  const rel = relative(src, file);
  const area = AREAS.find(([prefix]) => rel.startsWith(prefix))?.[1] ?? "Pages";
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g)) {
    const id = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]+\}/g, "<id>");
    if (!groups.has(area)) groups.set(area, new Map());
    const ids = groups.get(area);
    if (!ids.has(id)) ids.set(id, new Set());
    ids.get(id).add(rel);
  }
}

const order = [...new Set(AREAS.map(([, a]) => a)), "Pages"];
let md = `# Test ids

Stable \`data-testid\` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. \`<id>\` marks a dynamic suffix (for example \`case-action-<id>\` is \`case-action-hide\`).

Generated from the source by \`node scripts/gen-testids.mjs\`; rerun it after adding or renaming an id.
`;
for (const area of order) {
  const ids = groups.get(area);
  if (!ids) continue;
  md += `\n## ${area}\n\n| Test id | Source |\n|---|---|\n`;
  for (const id of [...ids.keys()].sort()) md += `| \`${id}\` | ${[...ids.get(id)].sort().map((f) => `\`${f}\``).join(", ")} |\n`;
}
writeFileSync(join(root, "TESTIDS.md"), md);
// A command-line script: printing the summary is its output.
// eslint-disable-next-line no-console
console.log(`TESTIDS.md: ${[...groups.values()].reduce((n, m) => n + m.size, 0)} ids`);
