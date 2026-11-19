import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { detectColumns, parseSheet, summarize, toImportItems, toNumber } from "./parse";
import { XlsxWorkbook, type Cell, type SheetRow } from "./xlsx";

/** Baris sheet dari array per baris (null = sel kosong). Baris pertama = nomor `start`. */
function rows(start: number, data: Cell[][]): SheetRow[] {
  return data
    .map((cells, i) => ({ r: start + i, cells }))
    .filter((r) => r.cells.some((c) => c !== null && c !== undefined));
}

describe("toNumber", () => {
  it.each([
    [1234.5, 1234.5],
    ["1.234.567,89", 1234567.89],
    ["12,5", 12.5],
    ["1,234.5", 1234.5],
    ["1.234.567", 1234567],
    ["1,234,567", 1234567],
    ["Rp 2.500", 2500],
    ["8.000", 8000],
    ["0,75", 0.75],
    ["abc", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(toNumber(input as Cell)).toBe(expected);
  });
});

// Format sipil: kode di A, uraian B, volume C, satuan D, harga E, jumlah F.
const civil = rows(1, [
  ["BILL OF QUANTITIES (BOQ)"],
  [],
  ["Pekerjaan", ": PEMBANGUNAN GEDUNG"],
  [],
  [],
  [],
  ["B.", "PEKERJAAN ARSITEKTUR"],
  ["no", "jenis pekerjaan", "volume", "satuan", "harga satuan", "jumlah harga"],
  ["I.", "Lantai Basement"],
  ["a.", "Pekerjaan Pasangan", null, null, null, 30000],
  [1, "pasangan bata", 10, "m2", 1000, 10000],
  [2, "plesteran", "2,5", "m2", "8.000", 20000],
  [],
  ["b.", "Penggantung"],
  [11, "penggantung plafon:", null, null, null, 0],
  [null, "C100x50", 5, "kg", 0, 0],
  [null, "besi d10", 2, "kg", 100, 200],
  [3, "metal perforated", 2, "m2", 100, 999],
  ["II.", "Lantai 1"],
  [1, "keramik", 4, "m2", 50, 200],
  [null, "Jumlah", null, null, null, 30399],
  [null, "PPN 12%", null, null, null, 3648],
]);

describe("detectColumns", () => {
  it("menemukan header satu baris", () => {
    expect(detectColumns(civil)).toEqual({
      headerRow: 8,
      code: 0,
      name: 1,
      volume: 2,
      unit: 3,
      price: 4,
      total: 5,
    });
  });

  it("menemukan header bertingkat (format MEP)", () => {
    const mep = rows(7, [
      ["NO", null, null, null, null, "HARGA", "JUMLAH"],
      [null, null, "URAIAN PEKERJAAN", "SAT", "VOL", "SATUAN", "HARGA"],
      [null, null, null, null, null, "( Rp )", "( Rp )"],
      [1, null, null, 3, 4, 5, 6],
      [null, "I", "PIPA AIR BERSIH"],
    ]);
    expect(detectColumns(mep)).toMatchObject({
      headerRow: 9,
      code: 1,
      name: 2,
      unit: 3,
      volume: 4,
      price: 5,
      total: 6,
    });
  });

  it("mengembalikan null untuk sheet non-BOQ", () => {
    expect(detectColumns(rows(1, [["Harga Satuan Bahan"], ["Nama", "Harga"]]))).toBeNull();
  });
});

describe("parseSheet (format sipil)", () => {
  const map = detectColumns(civil)!;
  const parsed = parseSheet(civil, map, { rootName: "rab ars", keyPrefix: "x" });
  const byName = (name: string) => parsed.nodes.find((n) => n.name === name)!;

  it("membaca judul sheet", () => {
    expect(parsed.title).toBe("PEKERJAAN ARSITEKTUR");
  });

  it("membangun hierarki romawi > huruf > angka", () => {
    expect(byName("Lantai Basement").level).toBe(2);
    expect(byName("Pekerjaan Pasangan").level).toBe(3);
    expect(byName("pasangan bata")).toMatchObject({ level: 4, volume: 10, unit: "m2", unitPrice: 1000, isLeaf: true });
    expect(byName("plesteran")).toMatchObject({ volume: 2.5, unitPrice: 8000 });
    // Item langsung di bawah romawi (tanpa grup huruf).
    expect(byName("keramik").level).toBe(3);
    expect(byName("keramik").parentKey).toBe(byName("Lantai 1").key);
  });

  it("item tanpa nomor di bawah judul bernomor menjadi anaknya", () => {
    const heading = byName("penggantung plafon:");
    expect(heading.isLeaf).toBe(false);
    expect(byName("C100x50").parentKey).toBe(heading.key);
    expect(byName("besi d10").parentKey).toBe(heading.key);
    expect(byName("metal perforated").parentKey).toBe(byName("Penggantung").key);
  });

  it("mengabaikan baris subtotal dan PPN", () => {
    expect(parsed.nodes.some((n) => /jumlah|ppn/i.test(n.name))).toBe(false);
  });

  it("memberi peringatan untuk harga 0 dan jumlah yang tidak cocok", () => {
    expect(byName("C100x50").warnings.join()).toMatch(/Harga satuan kosong/);
    expect(byName("metal perforated").warnings.join()).toMatch(/tidak sama/);
    expect(byName("pasangan bata").warnings).toEqual([]);
  });

  it("menghitung total dari volume × harga satuan", () => {
    expect(summarize(parsed.nodes)).toMatchObject({ items: 6, total: 10000 + 20000 + 0 + 200 + 200 + 200 });
  });

  it("menghasilkan payload berurutan induk-sebelum-anak", () => {
    const items = toImportItems(parsed.nodes);
    const seen = new Set<string>();
    for (const it of items) {
      if (it.parent_key) expect(seen.has(it.parent_key)).toBe(true);
      seen.add(it.key);
    }
    expect(items[0]).toMatchObject({ level: 1, name: "rab ars", parent_key: null });
  });
});

describe("parseSheet (format struktur & MEP)", () => {
  it("teks di kolom antara uraian dan volume menjadi spesifikasi", () => {
    const str = rows(8, [
      ["No", "Jenis Pekerjaan", null, "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
      ["I.", "Pondasi"],
      [1, "bor pile", "beton f'c = 25 Mpa", 10, "m3", 100, 1000],
    ]);
    const parsed = parseSheet(str, detectColumns(str)!, { rootName: "STR", keyPrefix: "s" });
    expect(parsed.nodes.at(-1)).toMatchObject({ name: "bor pile", spec: "beton f'c = 25 Mpa", volume: 10 });
  });

  it("menangani romawi/huruf ambigu, baris spesifikasi, dan volume di baris spesifikasi", () => {
    const mep = rows(7, [
      ["NO", null, null, null, null, "HARGA", "JUMLAH"],
      [null, null, "URAIAN PEKERJAAN", "SAT", "VOL", "SATUAN", "HARGA"],
      [null, null, null, null, null, "( Rp )", "( Rp )"],
      [1, null, null, 3, 4, 5, 6],
      [null, "I", "PIPA AIR BERSIH"],
      [null, "A", "Suplai"],
      [null, "A.1", "Jaringan"],
      [null, 1, null, "Pipa GIP 50mm", "m'", 100, 10],
      [null, 2, null, "Multimedia Filter"],
      [null, null, null, "-", "set", 1, 500],
    ]);
    // Kolom uraian MEP mulai di C, item di D: geser data supaya sesuai header.
    const map = detectColumns(mep)!;
    const parsed = parseSheet(mep, { ...map, unit: 4, volume: 5, price: 6, total: null }, {
      rootName: "I.AB",
      keyPrefix: "m",
    });
    const names = parsed.nodes.map((n) => `${n.level}:${n.name}`);
    expect(names).toContain("2:PIPA AIR BERSIH");
    expect(names).toContain("3:Suplai");
    expect(names).toContain("4:Jaringan");
    expect(parsed.nodes.some((n) => n.name === "1" || n.name === "3")).toBe(false);
  });

  it("huruf I setelah H dibaca sebagai huruf, bukan romawi", () => {
    const sheet = rows(1, [
      ["no", "uraian", "vol", "sat", "harga satuan"],
      ["I", "SISTEM"],
      ["H", "Grup H"],
      [1, "item h", 1, "ls", 1],
      ["I", "Grup I"],
      [1, "item i", 1, "ls", 1],
    ]);
    const parsed = parseSheet(sheet, detectColumns(sheet)!, { rootName: "R", keyPrefix: "r" });
    const grupI = parsed.nodes.find((n) => n.name === "Grup I")!;
    expect(grupI.level).toBe(3);
  });

  it("membatasi kedalaman ke 6 level", () => {
    const deep = rows(1, [
      ["no", "uraian", "vol", "sat", "harga satuan"],
      ["I", "L2"],
      ["A", "L3"],
      ["A.1", "L4"],
      ["a", "L5"],
      ["A.1.1", "L6"],
      [1, "terlalu dalam", 1, "ls", 1],
    ]);
    const parsed = parseSheet(deep, detectColumns(deep)!, { rootName: "R", keyPrefix: "d" });
    const leaf = parsed.nodes.find((n) => n.name === "terlalu dalam")!;
    expect(leaf.level).toBeLessThanOrEqual(6);
    expect(leaf.warnings.join()).toMatch(/Lebih dalam/);
  });
});

describe("XlsxWorkbook", () => {
  function makeXlsx() {
    return zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook xmlns:r="r"><definedNames><definedName name="x">A</definedName></definedNames>` +
          `<sheets><sheet name="rab &amp; boq" sheetId="1" r:id="rId1"/>` +
          `<sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/>` +
          `<Relationship Id="rId3" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
      "xl/sharedStrings.xml": strToU8(
        `<sst><si><t>uraian</t></si><si><r><t>pasangan </t></r><r><t>bata</t></r></si><si><t xml:space="preserve">f&apos;c</t></si></sst>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet><sheetData>` +
          `<row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1"><v>1.5</v></c></row>` +
          `<row r="2"/>` +
          `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="str"><f>X</f><v>hasil</v></c>` +
          `<c r="C3" t="inlineStr"><is><t>inline</t></is></c><c r="D3" t="e"><v>#REF!</v></c>` +
          `<c r="AA3" t="s"><v>2</v></c></row>` +
          `</sheetData></worksheet>`,
      ),
      "xl/worksheets/sheet2.xml": strToU8(`<worksheet><sheetData/></worksheet>`),
      "xl/externalLinks/externalLink1.xml": strToU8("<x/>".repeat(1000)),
    });
  }

  it("membaca daftar sheet, shared strings, tipe sel, dan kolom jauh", () => {
    const wb = new XlsxWorkbook(makeXlsx());
    expect(wb.sheets).toEqual([
      { name: "rab & boq", path: "xl/worksheets/sheet1.xml", hidden: false },
      { name: "Hidden", path: "xl/worksheets/sheet2.xml", hidden: true },
    ]);
    const data = wb.readSheet("rab & boq");
    expect(data.map((r) => r.r)).toEqual([1, 3]);
    expect(data[0].cells[1]).toBe("uraian");
    expect(data[0].cells[2]).toBe(1.5);
    expect(data[1].cells[0]).toBe("pasangan bata");
    expect(data[1].cells[1]).toBe("hasil");
    expect(data[1].cells[2]).toBe("inline");
    expect(data[1].cells[3]).toBeUndefined();
    expect(data[1].cells[26]).toBe("f'c");
  });

  it("menolak file yang bukan xlsx", () => {
    expect(() => new XlsxWorkbook(new Uint8Array([1, 2, 3]))).toThrow(/bukan .xlsx/);
  });
});
