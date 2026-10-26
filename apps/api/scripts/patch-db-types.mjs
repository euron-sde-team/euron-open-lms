// The pool parses int8 and numeric to JS numbers (src/db/kysely.ts), so the generated
// column types must say number too. Money is int8 minor units, well below 2^53.
import fs from "node:fs";

const file = new URL("../src/db/types.ts", import.meta.url);
const src = fs.readFileSync(file, "utf8");
const out = src
  .replace(/export type Int8 = ColumnType<string, [^;]*;/, "export type Int8 = ColumnType<number, bigint | number | string, bigint | number | string>;")
  .replace(/export type Numeric = ColumnType<string, [^;]*;/, "export type Numeric = ColumnType<number, number | string, number | string>;");
fs.writeFileSync(file, out);
