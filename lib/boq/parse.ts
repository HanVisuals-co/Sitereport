/**
 * Parser RAB/BOQ dari baris sheet menjadi pohon item.
 *
 * Format yang ditangani (dari RAB nyata):
 * - Header satu baris ("no | jenis pekerjaan | volume | satuan | harga satuan | jumlah harga")
 *   atau bertingkat ("HARGA" di atas "SATUAN").
 * - Penanda level: romawi (I., II), huruf (A, a.), huruf+angka (A.1), angka (1, 1.1).
 * - Baris spesifikasi ("- Kapasitas 6 m3/jam") dan teks tambahan di kolom antara uraian
 *   dan volume ("mutu f'c = 25 Mpa").
 * - Baris subtotal/PPN/total diabaikan; total dihitung ulang dari volume × harga satuan.
 */
import type { Cell, SheetRow } from "./xlsx";

export const MAX_LEVEL = 6;

export type ColumnMap = {
  headerRow: number;
  code: number | null;
  name: number;
  volume: number;
  unit: number;
  price: number | null;
  total: number | null;
};

export type BoqNode = {
  key: string;
  parentKey: string | null;
  level: number;
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  volume: number | null;
  unitPrice: number | null;
  row: number;
  isLeaf: boolean;
  warnings: string[];
};

export type ParsedSheet = {
  title: string | null;
  nodes: BoqNode[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Utilitas sel
// ---------------------------------------------------------------------------
function text(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\s+/g, " ").trim();
}

/** Angka dari sel. Mendukung "1.234.567,89", "12,5", "1,234.5". */
export function toNumber(cell: Cell | undefined): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const s = text(cell).replace(/^rp\.?\s*/i, "").replace(/\s/g, "");
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized =
      lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234,567" (ribuan) vs "12,5" (desimal)
    normalized = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Gaya Indonesia: titik = pemisah ribuan ("8.000" = 8000).
    normalized = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Deteksi kolom
// ---------------------------------------------------------------------------
const MARKER =
  /^(?:[IVXLC]+\.?|[A-Za-z]\.?|[A-Z]\.\d+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.?)$/;

export function detectColumns(rows: SheetRow[]): ColumnMap | null {
  const top = rows.filter((r) => r.r <= 60);
  const byNumber = new Map(rows.map((r) => [r.r, r]));

  for (const row of top) {
    const texts = row.cells.map((c) => text(c).toLowerCase());
    const hasVol = texts.some((t) => /^vol(\.|ume)?$|\bvolume\b/.test(t));
    if (!hasVol) continue;

    // Gabungkan teks header dari baris di atas, dan baris di bawah kalau itu lanjutan header
    // (mis. "( Rp )"), bukan baris data pertama.
    const below = byNumber.get(row.r + 1);
    const belowIsHeader =
      !!below &&
      below.cells.every((c) => c === null || c === undefined || typeof c === "string") &&
      below.cells.some((c) => /harga|satuan|jumlah|rp|\(/i.test(text(c))) &&
      !below.cells.some((c) => MARKER.test(text(c)));
    const headerRows = [byNumber.get(row.r - 1), row, belowIsHeader ? below : undefined].filter(
      (r): r is SheetRow => !!r,
    );
    const width = Math.max(...headerRows.map((r) => r.cells.length));
    const col: string[] = [];
    for (let c = 0; c < width; c++) {
      col[c] = headerRows
        .map((r) => text(r.cells[c]).toLowerCase())
        .filter(Boolean)
        .join(" ");
    }
    const find = (pred: (t: string) => boolean) => {
      const i = col.findIndex((t) => !!t && pred(t));
      return i >= 0 ? i : null;
    };

    const volume = find((t) => /\bvol(\.|ume)?\b/.test(t));
    const unit = find((t) => /\bsat(\.|uan)?\b/.test(t) && !/harga/.test(t));
    const price = find((t) => /harga/.test(t) && /satuan|sat\b/.test(t));
    const total = find((t) => /jumlah|total/.test(t) && /harga|rp/.test(t));
    const name = find((t) => /uraian|jenis pekerjaan|pekerjaan|deskripsi|item/.test(t));
    if (volume === null || unit === null || name === null) continue;

    const headerRow = Math.max(...headerRows.map((r) => r.r));
    return { headerRow, code: detectCodeColumn(rows, headerRow, name), name, volume, unit, price, total };
  }
  return null;
}

function detectCodeColumn(rows: SheetRow[], headerRow: number, nameCol: number): number | null {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.r <= headerRow) continue;
    // Lewati baris nomor kolom ("1 2 3 4 5") yang semua isinya angka.
    if (row.cells.every((c) => c === undefined || c === null || typeof c === "number")) continue;
    for (let c = 0; c < nameCol; c++) {
      const t = text(row.cells[c]);
      if (t && MARKER.test(t)) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** Judul sheet di atas header, mis. "PEKERJAAN ARSITEKTUR". */
export function detectTitle(rows: SheetRow[], headerRow: number): string | null {
  for (const row of rows) {
    if (row.r >= headerRow) break;
    for (const cell of row.cells) {
      const t = text(cell);
      if (/^PEKERJAAN\s+\S+/.test(t) && t === t.toUpperCase()) return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Klasifikasi penanda
// ---------------------------------------------------------------------------
type Marker =
  | { kind: "group"; type: string }
  | { kind: "number"; depth: number }
  | { kind: "bullet" }
  | { kind: "none" };

const ROMAN = /^[IVXLC]+$/;

function classify(raw: string, lastUpper: string | null): Marker {
  const t = raw.replace(/\.$/, "");
  if (!raw) return { kind: "none" };
  if (/^[-–•·*]$/.test(raw)) return { kind: "bullet" };
  if (/^\d+(\.\d+)*$/.test(t)) return { kind: "number", depth: t.split(".").length };
  if (/^[A-Z]\.\d+(\.\d+)*$/.test(t)) return { kind: "group", type: `upnum${t.split(".").length}` };
  if (/^[A-Z]$/.test(t)) {
    // "I", "V", "X" bisa romawi atau huruf. Huruf kalau melanjutkan urutan huruf sebelumnya.
    const continuesLetters =
      lastUpper !== null && t.charCodeAt(0) === lastUpper.charCodeAt(0) + 1;
    if (ROMAN.test(t) && !continuesLetters) return { kind: "group", type: "roman" };
    return { kind: "group", type: raw.endsWith(".") ? "upper." : "upper" };
  }
  if (ROMAN.test(t)) return { kind: "group", type: "roman" };
  if (/^[a-z]$/.test(t)) return { kind: "group", type: "lower" };
  return { kind: "none" };
}

const SUMMARY = /^(jumlah|sub\s*total|total|ppn|pajak|dibulatkan|pembulatan|terbilang|grand\s*total)\b/i;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
type Frame = { rank: number; node: BoqNode; unmarked: boolean };

function formatRupiah(n: number) {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

export function parseSheet(
  rows: SheetRow[],
  map: ColumnMap,
  opts: { rootName: string; keyPrefix: string },
): ParsedSheet {
  const warnings: string[] = [];
  const nodes: BoqNode[] = [];
  let seq = 0;
  const newKey = () => `${opts.keyPrefix}${seq++}`;

  const root: BoqNode = {
    key: newKey(),
    parentKey: null,
    level: 1,
    code: null,
    name: opts.rootName,
    spec: null,
    unit: null,
    volume: null,
    unitPrice: null,
    row: map.headerRow,
    isLeaf: false,
    warnings: [],
  };
  nodes.push(root);
  const byKey = new Map<string, BoqNode>([[root.key, root]]);

  // Urutan grup ditentukan oleh urutan kemunculan jenis penanda; angka selalu paling dalam.
  const groupRank = new Map<string, number>();
  const NUMBER_BASE = 100;
  const stack: Frame[] = [];
  let lastUpper: string | null = null;
  let last: BoqNode | null = null;

  const firstDataCol = Math.min(
    ...[map.volume, map.unit, map.price, map.total].filter((c): c is number => c !== null),
  );

  for (const row of rows) {
    if (row.r <= map.headerRow) continue;

    const rawCode = map.code !== null ? text(row.cells[map.code]) : "";
    // Teks di antara kolom uraian dan kolom angka pertama.
    const texts: string[] = [];
    for (let c = map.name; c < firstDataCol; c++) {
      const t = text(row.cells[c]);
      if (t && t !== ".") texts.push(t);
    }
    const volume = toNumber(row.cells[map.volume]);
    const unit = text(row.cells[map.unit]) || null;
    let unitPrice = map.price !== null ? toNumber(row.cells[map.price]) : null;
    const total = map.total !== null ? toNumber(row.cells[map.total]) : null;

    const marker = classify(rawCode, lastUpper);

    // Baris spesifikasi: "- ..." di kolom kode atau di kolom uraian.
    const bulletInText = texts[0] && /^[-–•·*]$/.test(texts[0]);
    if (marker.kind === "bullet" || bulletInText) {
      const content = (bulletInText ? texts.slice(1) : texts).join(" ");
      if (last) {
        if (content) last.spec = last.spec ? `${last.spec}; ${content}` : content;
        // Format MEP: volume & satuan item tertulis di baris spesifikasi pertamanya.
        if (last.volume === null && !last.unit && (volume !== null || unit)) {
          last.volume = volume;
          last.unit = unit;
          last.unitPrice = unitPrice ?? (total !== null && volume ? total / volume : null);
        }
      }
      continue;
    }

    if (texts.length === 0) continue; // baris kosong berformat, dll.
    const name = texts[0];
    // Baris nomor kolom ("1 2 3 4 5") di bawah header.
    if (/^[\d\s.,()-]+$/.test(texts.join(" "))) continue;
    if (SUMMARY.test(name) || SUMMARY.test(rawCode)) continue;
    const extraSpec = texts.slice(1).join(" ") || null;

    let rank: number;
    const top = stack[stack.length - 1];
    let unmarked = false;
    if (marker.kind === "group") {
      if (!groupRank.has(marker.type)) groupRank.set(marker.type, groupRank.size);
      rank = groupRank.get(marker.type)!;
      if (marker.type.startsWith("upper")) lastUpper = rawCode.replace(/\.$/, "");
    } else if (marker.kind === "number") {
      rank = NUMBER_BASE + marker.depth;
    } else if (volume !== null || unit) {
      // Tanpa penanda tapi ada volume/satuan: anggap item.
      unmarked = true;
      if (top?.unmarked) {
        // Saudara dari item tanpa nomor sebelumnya.
        rank = top.rank;
      } else if (top && top.node.volume === null && !top.node.unit) {
        // Di bawah judul bernomor tanpa volume ("2 rangka ... :"): jadi anaknya.
        rank = top.rank + 0.5;
      } else {
        rank = NUMBER_BASE + 1;
      }
    } else {
      // Teks keterangan tanpa penanda: tempel ke baris sebelumnya.
      if (last) last.spec = last.spec ? `${last.spec}; ${texts.join(" ")}` : texts.join(" ");
      continue;
    }

    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    const parentFrame = stack[stack.length - 1];
    let parent = parentFrame ? parentFrame.node : root;
    let level = parent.level + 1;

    const nodeWarnings: string[] = [];
    if (level > MAX_LEVEL) {
      // Terlalu dalam: gantung di leluhur level MAX_LEVEL - 1.
      while (parent.level >= MAX_LEVEL && parent.parentKey) {
        parent = byKey.get(parent.parentKey) ?? root;
      }
      level = parent.level + 1;
      nodeWarnings.push(`Lebih dalam dari ${MAX_LEVEL} level, dipindah ke level ${level}.`);
    }

    if (unitPrice === null && total !== null && volume) unitPrice = total / volume;
    if (unitPrice !== null && total !== null && volume !== null) {
      const calc = volume * unitPrice;
      if (Math.abs(total - calc) > Math.max(1, Math.abs(total) * 0.005)) {
        nodeWarnings.push(
          `Jumlah harga di file ${formatRupiah(total)} tidak sama dengan volume × harga satuan ${formatRupiah(calc)}. Yang dipakai: volume × harga satuan.`,
        );
      }
    }

    const node: BoqNode = {
      key: newKey(),
      parentKey: parent.key,
      level,
      code: rawCode || null,
      name,
      spec: extraSpec,
      unit,
      volume,
      unitPrice,
      row: row.r,
      isLeaf: true,
      warnings: nodeWarnings,
    };
    parent.isLeaf = false;
    nodes.push(node);
    byKey.set(node.key, node);
    stack.push({ rank, node, unmarked });
    last = node;
  }

  // Rapikan: grup tidak membawa volume/harga; daun tanpa volume/harga diberi peringatan.
  const hasChild = new Set(nodes.map((n) => n.parentKey).filter(Boolean));
  for (const n of nodes) {
    n.isLeaf = !hasChild.has(n.key) && n !== root;
    if (!n.isLeaf) {
      if (n.volume !== null && n !== root) {
        n.warnings.push("Baris ini punya sub-item, jadi volumenya diabaikan.");
      }
      n.unit = null;
      n.volume = null;
      n.unitPrice = null;
      continue;
    }
    if (n.volume === null) n.warnings.push("Volume kosong.");
    else if (n.volume === 0) n.warnings.push("Volume 0.");
    if (!n.unit) n.warnings.push("Satuan kosong.");
    if (n.unitPrice === null || n.unitPrice === 0) n.warnings.push("Harga satuan kosong atau 0.");
  }

  if (nodes.length === 1) warnings.push("Tidak ada item yang terbaca. Cek pemetaan kolom.");

  return { title: detectTitle(rows, map.headerRow), nodes, warnings };
}

// ---------------------------------------------------------------------------
// Ringkasan & payload
// ---------------------------------------------------------------------------
export function summarize(nodes: BoqNode[]) {
  let items = 0;
  let total = 0;
  let warned = 0;
  for (const n of nodes) {
    if (n.isLeaf) {
      items++;
      total += (n.volume ?? 0) * (n.unitPrice ?? 0);
    }
    if (n.warnings.length) warned++;
  }
  return { items, groups: nodes.length - items, total, warned };
}

export type ImportItem = {
  key: string;
  parent_key: string | null;
  level: number;
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  volume: number | null;
  unit_price: number | null;
};

export function toImportItems(nodes: BoqNode[]): ImportItem[] {
  return nodes.map((n) => ({
    key: n.key,
    parent_key: n.parentKey,
    level: n.level,
    code: n.code,
    name: n.name.slice(0, 500),
    spec: n.spec,
    unit: n.unit,
    volume: n.volume === null ? null : Math.round(n.volume * 10000) / 10000,
    unit_price: n.unitPrice === null ? null : Math.round(n.unitPrice * 100) / 100,
  }));
}
