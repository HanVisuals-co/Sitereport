// Coba parser BOQ pada file RAB lokal: npx tsx scripts/try-boq-parse.ts <file.xlsx> [sheet...]
import { readFileSync } from "node:fs";

import { detectColumns, parseSheet, summarize } from "../lib/boq/parse";
import { XlsxWorkbook } from "../lib/boq/xlsx";

const [file, ...only] = process.argv.slice(2);
const t0 = performance.now();
const wb = new XlsxWorkbook(new Uint8Array(readFileSync(file)));
console.log(`sheets: ${wb.sheets.length} (${Math.round(performance.now() - t0)} ms)`);

for (const s of wb.sheets) {
  if (only.length && !only.includes(s.name)) continue;
  const t1 = performance.now();
  const rows = wb.readSheet(s.name);
  const map = detectColumns(rows);
  if (!map) {
    console.log(`- ${s.name}: bukan RAB (${rows.length} baris)`);
    continue;
  }
  const parsed = parseSheet(rows, map, { rootName: s.name, keyPrefix: "k" });
  const sum = summarize(parsed.nodes);
  console.log(
    `+ ${s.name}: title=${parsed.title} map=${JSON.stringify(map)} items=${sum.items} groups=${sum.groups} total=${Math.round(sum.total).toLocaleString("id-ID")} warned=${sum.warned} (${Math.round(performance.now() - t1)} ms)`,
  );
  if (only.length) {
    for (const n of parsed.nodes.slice(0, Number(process.env.N ?? 40))) {
      console.log(
        `${"  ".repeat(n.level - 1)}[${n.level}] ${n.code ?? ""} ${n.name}${n.spec ? ` {${n.spec}}` : ""}${n.isLeaf ? ` | ${n.volume} ${n.unit} @ ${n.unitPrice}` : ""}${n.warnings.length ? ` !${n.warnings.join(" ")}` : ""}`,
      );
    }
  }
}
