"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import {
  detectColumns,
  parseSheet,
  summarize,
  toImportItems,
  type BoqNode,
  type ColumnMap,
  type ParsedSheet,
} from "@/lib/boq/parse";
import { XlsxError, XlsxWorkbook, type SheetRow } from "@/lib/boq/xlsx";
import { columnLetter, formatNumber, formatRupiah } from "@/lib/format";

import { importBoq } from "../actions";

const MAX_FILE_MB = 50;
const MAX_ROWS = 5000;
// Sheet pendukung yang biasanya bukan BOQ.
const NON_BOQ_NAME = /ahsp|analisa|durasi|jadwal|kurva|perhitungan|rekap|harga satuan|upah|bahan|alat/i;

type SheetState = {
  name: string;
  hidden: boolean;
  rows: SheetRow[];
  width: number;
  map: ColumnMap | null;
  selected: boolean;
  rootName: string;
  parsed: ParsedSheet | null;
};

type MapField = "code" | "name" | "volume" | "unit" | "price" | "total";
const FIELDS: { key: MapField; label: string; required: boolean }[] = [
  { key: "code", label: "No / kode", required: false },
  { key: "name", label: "Uraian", required: true },
  { key: "volume", label: "Volume", required: true },
  { key: "unit", label: "Satuan", required: true },
  { key: "price", label: "Harga satuan", required: false },
  { key: "total", label: "Jumlah harga", required: false },
];

function parse(sheet: Pick<SheetState, "rows" | "map" | "rootName">, index: number) {
  if (!sheet.map) return null;
  return parseSheet(sheet.rows, sheet.map, {
    rootName: sheet.rootName.trim() || "BOQ",
    keyPrefix: `s${index}-`,
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function BoqImporter({
  slug,
  projectId,
  existingCount,
}: {
  slug: string;
  projectId: string;
  existingCount: number;
}) {
  const [status, setStatus] = useState<"idle" | "reading" | "ready">("idle");
  const [progress, setProgress] = useState("");
  const [fileError, setFileError] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [replace, setReplace] = useState(false);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, startSubmit] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    setFileError(undefined);
    setSubmitError(undefined);
    setSheets([]);
    if (!/\.xlsx$/i.test(file.name)) {
      setFileError("Gunakan file .xlsx. File .xls lama: buka di Excel lalu Simpan Sebagai .xlsx.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setFileError(`File lebih dari ${MAX_FILE_MB} MB.`);
      return;
    }
    setFileName(file.name);
    setStatus("reading");
    setProgress("Membuka file…");
    await yieldToBrowser();

    try {
      const wb = new XlsxWorkbook(new Uint8Array(await file.arrayBuffer()));
      const out: SheetState[] = [];
      for (const [i, info] of wb.sheets.entries()) {
        setProgress(`Membaca sheet ${i + 1} dari ${wb.sheets.length}: ${info.name}`);
        await yieldToBrowser();
        const rows = wb.readSheet(info.name);
        const width = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
        const map = detectColumns(rows);
        const draft = { rows, map, rootName: info.name };
        const first = map ? parse(draft, i) : null;
        const rootName = first?.title ?? info.name;
        const parsed = map ? parse({ ...draft, rootName }, i) : null;
        const sum = parsed ? summarize(parsed.nodes) : null;
        const selected =
          !info.hidden &&
          !!map &&
          map.price !== null &&
          !!sum &&
          sum.items > 0 &&
          !NON_BOQ_NAME.test(info.name);
        out.push({ name: info.name, hidden: info.hidden, rows, width, map, selected, rootName, parsed });
      }
      setSheets(out);
      setStatus("ready");
    } catch (e) {
      setStatus("idle");
      setFileError(
        e instanceof XlsxError ? e.message : "File tidak bisa dibaca. Pastikan file .xlsx tidak rusak.",
      );
    }
  }

  function updateSheet(index: number, patch: Partial<SheetState>) {
    setSheets((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...patch };
        if ("map" in patch || "rootName" in patch) next.parsed = parse(next, i);
        return next;
      }),
    );
  }

  function setColumn(index: number, field: MapField, value: string) {
    const s = sheets[index];
    if (!s.map) return;
    const col = value === "" ? null : Number(value);
    if ((field === "name" || field === "volume" || field === "unit") && col === null) return;
    updateSheet(index, { map: { ...s.map, [field]: col } as ColumnMap });
  }

  const selected = sheets.filter((s) => s.selected && s.parsed);
  const allNodes = useMemo(() => selected.flatMap((s) => s.parsed!.nodes), [selected]);
  const totals = useMemo(() => summarize(allNodes), [allNodes]);
  const tooMany = allNodes.length > MAX_ROWS;
  const needsReplace = existingCount > 0 && !replace;

  function submit() {
    setSubmitError(undefined);
    startSubmit(async () => {
      const result = await importBoq(slug, projectId, toImportItems(allNodes), existingCount > 0);
      // Kalau berhasil, server action mengarahkan ke halaman BOQ.
      if (result && !result.ok) setSubmitError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">1. Pilih file</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={status === "reading"}
            onClick={() => inputRef.current?.click()}
          >
            {status === "ready" ? "Ganti file" : "Pilih file .xlsx"}
          </Button>
          {fileName && <span className="truncate text-sm text-zinc-700">{fileName}</span>}
        </div>
        {status === "reading" && (
          <p role="status" className="mt-3 text-sm text-zinc-600">
            {progress}
          </p>
        )}
        <div className="mt-3">
          <FormError message={fileError} />
        </div>
      </section>

      {status === "ready" && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">2. Pilih sheet BOQ</h2>
            <p className="mb-3 text-sm text-zinc-600">
              Sheet yang terdeteksi sebagai BOQ sudah dicentang. Setiap sheet menjadi satu grup
              teratas.
            </p>
            <ul className="flex flex-col divide-y divide-zinc-100">
              {sheets.map((s, i) => {
                const sum = s.parsed ? summarize(s.parsed.nodes) : null;
                return (
                  <li key={s.name} className="flex items-center gap-3 py-2">
                    <input
                      id={`sheet-${i}`}
                      type="checkbox"
                      className="size-5"
                      checked={s.selected}
                      disabled={!s.map}
                      onChange={(e) => updateSheet(i, { selected: e.target.checked })}
                    />
                    <label htmlFor={`sheet-${i}`} className="flex-1 text-sm">
                      <span className="font-medium">{s.name}</span>
                      {s.hidden && <span className="text-zinc-500"> (tersembunyi)</span>}
                      <span className="block text-zinc-600">
                        {!s.map
                          ? "Bukan tabel BOQ (tidak ada kolom volume/satuan)"
                          : `${sum!.items} item · ${formatRupiah(sum!.total)}${sum!.warned ? ` · ${sum!.warned} peringatan` : ""}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {sheets.map((s, i) =>
            s.selected && s.map && s.parsed ? (
              <SheetPreview
                key={s.name}
                sheet={s}
                onRootName={(v) => updateSheet(i, { rootName: v })}
                onColumn={(field, v) => setColumn(i, field, v)}
                onlyWarnings={onlyWarnings}
              />
            ) : null,
          )}

          <section className="sticky bottom-0 rounded-2xl border border-zinc-300 bg-white p-4 shadow-lg">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p>
                  <span className="font-semibold">{totals.items.toLocaleString("id-ID")}</span> item
                  dalam {totals.groups.toLocaleString("id-ID")} grup ·{" "}
                  <span className="font-semibold">{formatRupiah(totals.total)}</span>
                </p>
                <label className="mt-1 flex items-center gap-2 text-zinc-700">
                  <input
                    type="checkbox"
                    checked={onlyWarnings}
                    onChange={(e) => setOnlyWarnings(e.target.checked)}
                  />
                  Tampilkan hanya baris dengan peringatan ({totals.warned})
                </label>
                {existingCount > 0 && (
                  <label className="mt-1 flex items-center gap-2 font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                    />
                    Ganti BOQ lama ({existingCount.toLocaleString("id-ID")} baris akan dihapus)
                  </label>
                )}
              </div>
              <Button
                type="button"
                onClick={submit}
                disabled={submitting || selected.length === 0 || tooMany || needsReplace}
              >
                {submitting ? "Menyimpan…" : "Simpan BOQ"}
              </Button>
            </div>
            {tooMany && (
              <p className="mt-2 text-sm text-red-700">
                Maksimal {MAX_ROWS.toLocaleString("id-ID")} baris per import. Kurangi sheet yang
                dipilih.
              </p>
            )}
            <div className="mt-2">
              <FormError message={submitError} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SheetPreview({
  sheet,
  onRootName,
  onColumn,
  onlyWarnings,
}: {
  sheet: SheetState;
  onRootName: (v: string) => void;
  onColumn: (field: MapField, value: string) => void;
  onlyWarnings: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const map = sheet.map!;
  const parsed = sheet.parsed!;
  const sum = summarize(parsed.nodes);
  const header = sheet.rows.find((r) => r.r === map.headerRow);

  const nodes = onlyWarnings ? parsed.nodes.filter((n) => n.warnings.length) : parsed.nodes;
  const visible = showAll ? nodes : nodes.slice(0, 150);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`root-${sheet.name}`} className="text-sm font-medium">
            Nama grup untuk sheet “{sheet.name}”
          </label>
          <input
            id={`root-${sheet.name}`}
            value={sheet.rootName}
            onChange={(e) => onRootName(e.target.value)}
            className="h-12 rounded-lg border border-zinc-300 px-3"
          />
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">
            Kolom terdeteksi (header baris {map.headerRow}) — ubah kalau salah
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                {f.label}
                <select
                  value={map[f.key] ?? ""}
                  onChange={(e) => onColumn(f.key, e.target.value)}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-2"
                >
                  {!f.required && <option value="">— tidak ada —</option>}
                  {Array.from({ length: sheet.width }, (_, c) => (
                    <option key={c} value={c}>
                      {columnLetter(c)}
                      {header?.cells[c] ? ` · ${String(header.cells[c]).slice(0, 24)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <p className="text-sm text-zinc-700">
          {sum.items} item · {sum.groups} grup · {formatRupiah(sum.total)}
          {sum.warned > 0 && <span className="text-amber-800"> · {sum.warned} peringatan</span>}
        </p>
        {parsed.warnings.map((w) => (
          <p key={w} className="text-sm text-red-700">
            {w}
          </p>
        ))}

        <div className="max-h-[32rem] overflow-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-2 py-1.5 font-medium">Baris</th>
                <th className="px-2 py-1.5 font-medium">Uraian</th>
                <th className="px-2 py-1.5 text-right font-medium">Volume</th>
                <th className="px-2 py-1.5 font-medium">Sat</th>
                <th className="px-2 py-1.5 text-right font-medium">Harga satuan</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((n) => (
                <PreviewRow key={n.key} node={n} />
              ))}
            </tbody>
          </table>
        </div>
        {nodes.length > visible.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="self-start text-sm font-medium underline"
          >
            Tampilkan semua {nodes.length.toLocaleString("id-ID")} baris
          </button>
        )}
      </div>
    </section>
  );
}

function PreviewRow({ node }: { node: BoqNode }) {
  return (
    <>
      <tr className={`border-t border-zinc-100 ${node.isLeaf ? "" : "bg-zinc-50/60"}`}>
        <td className="px-2 py-1 align-top text-xs text-zinc-500">{node.level > 1 ? node.row : ""}</td>
        <td className="px-2 py-1 align-top">
          <div style={{ paddingLeft: `${(node.level - 1) * 1}rem` }}>
            <span className={node.isLeaf ? "" : "font-medium"}>
              {node.code && <span className="mr-1 font-mono text-zinc-500">{node.code}</span>}
              {node.name}
            </span>
            {node.spec && <span className="block text-xs text-zinc-500">{node.spec}</span>}
          </div>
        </td>
        <td className="px-2 py-1 text-right align-top tabular-nums">
          {node.isLeaf ? formatNumber(node.volume) : ""}
        </td>
        <td className="px-2 py-1 align-top">{node.isLeaf ? node.unit : ""}</td>
        <td className="px-2 py-1 text-right align-top tabular-nums">
          {node.isLeaf ? formatRupiah(node.unitPrice) : ""}
        </td>
      </tr>
      {node.warnings.length > 0 && (
        <tr>
          <td />
          <td colSpan={4} className="px-2 pb-1 text-xs text-amber-800">
            <div style={{ paddingLeft: `${(node.level - 1) * 1}rem` }}>{node.warnings.join(" ")}</div>
          </td>
        </tr>
      )}
    </>
  );
}
