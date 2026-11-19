/**
 * Pembaca .xlsx ringan. Hanya membuka bagian zip yang dibutuhkan (daftar sheet,
 * shared strings, dan sheet yang dipilih), jadi file RAB besar dengan ratusan
 * external link dan sheet AHSP tetap ringan. Berjalan di browser maupun Node.
 *
 * Yang dibaca hanya nilai sel (hasil cache formula), bukan formula atau gaya.
 */
import { strFromU8, unzipSync } from "fflate";

export type Cell = string | number | null;
export type SheetRow = { r: number; cells: Cell[] };
export type SheetInfo = { name: string; path: string; hidden: boolean };

export class XlsxError extends Error {}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] !== "#") return ENTITY[e];
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function textOf(fragment: string): string {
  // Gabungkan semua <t>, abaikan teks fonetik <rPh>.
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

export class XlsxWorkbook {
  readonly sheets: SheetInfo[];
  private readonly data: Uint8Array;
  private sharedStrings: string[] | null = null;
  private readonly sharedStringsPath: string | null;

  constructor(data: Uint8Array) {
    this.data = data;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(data, {
        filter: (f) =>
          f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels",
      });
    } catch {
      throw new XlsxError("File bukan .xlsx yang valid.");
    }
    const workbook = files["xl/workbook.xml"];
    const rels = files["xl/_rels/workbook.xml.rels"];
    if (!workbook || !rels) throw new XlsxError("File bukan .xlsx yang valid.");

    const targets = new Map<string, string>();
    let sharedStringsPath: string | null = null;
    for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], "Id");
      const target = attr(m[0], "Target");
      const type = attr(m[0], "Type") ?? "";
      if (!id || !target) continue;
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      targets.set(id, path);
      if (type.endsWith("/sharedStrings")) sharedStringsPath = path;
    }
    this.sharedStringsPath = sharedStringsPath;

    // Hanya bagian <sheets>, karena workbook.xml bisa berisi ribuan definedName.
    const wbXml = strFromU8(workbook);
    const sheetsBlock = /<sheets>([\s\S]*?)<\/sheets>/.exec(wbXml)?.[1] ?? "";
    this.sheets = [];
    for (const m of sheetsBlock.matchAll(/<sheet\b[^>]*>/g)) {
      const name = attr(m[0], "name");
      const rid = /\s[\w]+:id="([^"]+)"/.exec(m[0])?.[1];
      const path = rid ? targets.get(rid) : undefined;
      if (!name || !path) continue;
      const state = attr(m[0], "state");
      this.sheets.push({ name, path, hidden: state === "hidden" || state === "veryHidden" });
    }
    if (this.sheets.length === 0) throw new XlsxError("Tidak ada sheet di file ini.");
  }

  private loadSharedStrings(): string[] {
    if (this.sharedStrings) return this.sharedStrings;
    const path = this.sharedStringsPath;
    if (!path) return (this.sharedStrings = []);
    const files = unzipSync(this.data, { filter: (f) => f.name === path });
    const xml = files[path] ? strFromU8(files[path]) : "";
    const out: string[] = [];
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(m[1] ? textOf(m[1]) : "");
    return (this.sharedStrings = out);
  }

  /** Baris tidak kosong dari satu sheet. Indeks sel = indeks kolom (A = 0). */
  readSheet(name: string): SheetRow[] {
    const sheet = this.sheets.find((s) => s.name === name);
    if (!sheet) throw new XlsxError(`Sheet "${name}" tidak ditemukan.`);
    const files = unzipSync(this.data, { filter: (f) => f.name === sheet.path });
    const bytes = files[sheet.path];
    if (!bytes) throw new XlsxError(`Isi sheet "${name}" tidak bisa dibaca.`);
    const xml = strFromU8(bytes);
    const shared = this.loadSharedStrings();

    const rows: SheetRow[] = [];
    let rowNumber = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rAttr = attr(rm[1], "r");
      rowNumber = rAttr ? parseInt(rAttr, 10) : rowNumber + 1;
      const body = rm[2];
      if (!body) continue;

      const cells: Cell[] = [];
      let col = -1;
      let hasValue = false;
      for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g) ) {
        const ref = attr(cm[1], "r");
        col = ref ? columnIndex(ref) : col + 1;
        const inner = cm[2];
        if (!inner) continue;
        const type = attr(cm[1], "t");

        let value: Cell = null;
        if (type === "inlineStr") {
          value = textOf(inner);
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          if (v === undefined) continue;
          if (type === "s") value = shared[parseInt(v, 10)] ?? null;
          else if (type === "str") value = decodeXml(v);
          else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = null; // #REF!, #DIV/0!, dll.
          else {
            const n = Number(v);
            value = Number.isFinite(n) ? n : decodeXml(v);
          }
        }
        if (typeof value === "string" && value.trim() === "") value = null;
        if (value === null) continue;
        cells[col] = value;
        hasValue = true;
      }
      if (hasValue) rows.push({ r: rowNumber, cells });
    }
    return rows;
  }
}
