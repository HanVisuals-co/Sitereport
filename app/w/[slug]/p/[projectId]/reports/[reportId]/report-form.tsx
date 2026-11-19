"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { toNumber } from "@/lib/boq/parse";
import { formatNumber } from "@/lib/format";
import {
  SECTION_LABEL,
  WEATHER_CONDS,
  WEATHER_SLOTS,
  type BoqLeaf,
  type DraftPayload,
  type ReportPhoto,
  type WeatherCond,
  type WeatherSlot,
} from "@/lib/reports/types";

import { addMasterQuick, saveDraft, submitReport, type QuickMaster } from "../actions";
import { PhotoSection } from "./photo-section";

type Kind = "labor" | "equipment" | "material";

type FormState = {
  notes_raw: string;
  weather: Record<WeatherSlot, { condition: WeatherCond | null; rain_hours: string }>;
  labor: Record<string, string>;
  equipment: Record<string, { count: string; hours: string }>;
  materials: { master_item_id: string; quantity: string }[];
  volumes: { boq_item_id: string; volume: string }[];
};

export type ReportFormProps = {
  slug: string;
  projectId: string;
  reportId: string;
  basePath: string;
  updatedAt: string;
  initial: Omit<DraftPayload, "notes_polished">;
  photos: ReportPhoto[];
  masters: Record<Kind, QuickMaster[]>;
  leaves: BoqLeaf[];
  revision: { note: string | null; comments: { section: string; comment: string }[] } | null;
};

const num = (s: string) => (s.trim() === "" ? 0 : (toNumber(s) ?? NaN));
const str = (n: number | undefined) => (n === undefined || n === 0 ? "" : String(n).replace(".", ","));

function fromPayload(p: ReportFormProps["initial"]): FormState {
  const weather = Object.fromEntries(
    WEATHER_SLOTS.map(({ slot }) => {
      const w = p.weather.find((x) => x.slot === slot);
      return [slot, { condition: w?.condition ?? null, rain_hours: str(w?.rain_hours) }];
    }),
  ) as FormState["weather"];
  return {
    notes_raw: p.notes_raw,
    weather,
    labor: Object.fromEntries(p.labor.map((l) => [l.master_item_id, String(l.count)])),
    equipment: Object.fromEntries(
      p.equipment.map((e) => [e.master_item_id, { count: String(e.count), hours: str(e.hours) }]),
    ),
    materials: p.materials.map((m) => ({ master_item_id: m.master_item_id, quantity: str(m.quantity) })),
    volumes: p.volumes.map((v) => ({ boq_item_id: v.boq_item_id, volume: str(v.volume) })),
  };
}

/** Ubah isian form menjadi payload. Mengembalikan pesan error kalau ada angka tidak valid. */
function toPayload(f: FormState): { payload: DraftPayload } | { error: string } {
  const bad = (label: string) => ({ error: `${label}: isi angka 0 atau lebih.` });
  const weather: DraftPayload["weather"] = [];
  for (const { slot, label } of WEATHER_SLOTS) {
    const w = f.weather[slot];
    if (!w.condition) continue;
    const rain = w.condition === "hujan" ? num(w.rain_hours) : 0;
    if (!(rain >= 0 && rain <= 24)) return { error: `Jam hujan ${label.toLowerCase()} tidak valid.` };
    weather.push({ slot, condition: w.condition, rain_hours: rain });
  }
  const labor: DraftPayload["labor"] = [];
  for (const [id, v] of Object.entries(f.labor)) {
    const n = num(v);
    if (!Number.isInteger(n) || n < 0) return bad("Jumlah tenaga kerja");
    if (n > 0) labor.push({ master_item_id: id, count: n });
  }
  const equipment: DraftPayload["equipment"] = [];
  for (const [id, v] of Object.entries(f.equipment)) {
    const c = num(v.count);
    const h = num(v.hours);
    if (!Number.isInteger(c) || c < 0 || !(h >= 0)) return bad("Alat");
    if (c > 0) equipment.push({ master_item_id: id, count: c, hours: h });
  }
  const materials: DraftPayload["materials"] = [];
  for (const m of f.materials) {
    const q = num(m.quantity);
    if (!(q >= 0)) return bad("Material");
    if (m.master_item_id && q > 0) materials.push({ master_item_id: m.master_item_id, quantity: q });
  }
  const volumes: DraftPayload["volumes"] = [];
  for (const v of f.volumes) {
    const n = num(v.volume);
    if (!(n >= 0)) return bad("Volume pekerjaan");
    if (n > 0) volumes.push({ boq_item_id: v.boq_item_id, volume: n });
  }
  return { payload: { notes_raw: f.notes_raw, notes_polished: "", weather, labor, equipment, materials, volumes } };
}

function Section({
  title,
  children,
  comment,
}: {
  title: string;
  children: ReactNode;
  comment?: string[];
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {comment && comment.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">Catatan Pengawas:</span> {comment.join(" ")}
        </div>
      )}
      {children}
    </section>
  );
}

const inputCls =
  "h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base tabular-nums outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20";

export function ReportForm(props: ReportFormProps) {
  const { slug, projectId, reportId } = props;
  const router = useRouter();
  const storageKey = `sitereport:draft:${reportId}`;
  const [form, setForm] = useState<FormState>(() => fromPayload(props.initial));
  const [masters, setMasters] = useState(props.masters);
  const [localDraft, setLocalDraft] = useState<FormState | null>(null);
  const [photoCount, setPhotoCount] = useState({ uploaded: props.photos.length, pending: 0 });
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [submitting, startSubmitting] = useTransition();
  const dirty = useRef(false);

  // Cadangan lokal: kalau ada isian yang belum tersimpan di perangkat ini, tawarkan pulihkan.
  // Dibaca setelah hydrate (localStorage tidak ada di server).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const saved = JSON.parse(raw) as { at: string; form: FormState };
        if (saved.at > props.updatedAt) setLocalDraft(saved.form);
        else localStorage.removeItem(storageKey);
      } catch {
        /* penyimpanan lokal tidak tersedia */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [storageKey, props.updatedAt]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ at: new Date().toISOString(), form }));
      } catch {
        /* abaikan */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form, storageKey]);

  const set = (fn: (f: FormState) => FormState) => {
    dirty.current = true;
    setMessage(null);
    setForm(fn);
  };

  const onPhotoCount = useCallback(
    (uploaded: number, pending: number) => setPhotoCount({ uploaded, pending }),
    [],
  );

  const comments = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of props.revision?.comments ?? []) (map[c.section] ??= []).push(c.comment);
    return map;
  }, [props.revision]);

  function clearLocal() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* abaikan */
    }
    dirty.current = false;
  }

  function save() {
    const r = toPayload(form);
    if ("error" in r) return setMessage({ kind: "error", text: r.error });
    startSaving(async () => {
      const res = await saveDraft(slug, projectId, reportId, r.payload);
      if (res.ok) {
        clearLocal();
        setMessage({ kind: "ok", text: "Draft tersimpan." });
        router.refresh();
      } else setMessage({ kind: "error", text: res.message });
    });
  }

  function submit() {
    const r = toPayload(form);
    if ("error" in r) return setMessage({ kind: "error", text: r.error });
    if (r.payload.weather.length < 3) return setMessage({ kind: "error", text: "Isi cuaca pagi, siang, dan sore." });
    if (photoCount.pending > 0) return setMessage({ kind: "error", text: "Tunggu semua foto selesai diunggah." });
    if (photoCount.uploaded === 0) return setMessage({ kind: "error", text: "Tambahkan minimal 1 foto." });
    if (!window.confirm("Kirim laporan ke Pengawas? Setelah dikirim, laporan tidak bisa diubah kecuali diminta revisi.")) return;

    startSubmitting(async () => {
      const res = await submitReport(slug, projectId, reportId, r.payload);
      if (!res.ok) return setMessage({ kind: "error", text: res.message });
      clearLocal();
      const notes: string[] = [];
      if (res.duplicates) notes.push(`${res.duplicates} isian mirip laporan lain dan akan dicek Pengawas.`);
      if (res.overContract?.length)
        notes.push(`Volume kumulatif melebihi kontrak: ${res.overContract.map((o) => o.name).join(", ")}.`);
      if (notes.length) window.alert(`Laporan terkirim.\n\n${notes.join("\n")}`);
      router.push(`/w/${slug}/p/${projectId}/reports`);
      router.refresh();
    });
  }

  async function quickAdd(kind: Kind) {
    const name = window.prompt(
      kind === "labor" ? "Nama kategori tenaga kerja baru" : kind === "equipment" ? "Nama alat baru" : "Nama material baru",
    );
    if (!name?.trim()) return;
    const unit =
      window.prompt("Satuan (opsional)", kind === "labor" ? "orang" : kind === "equipment" ? "unit" : "") ?? "";
    const res = await addMasterQuick(slug, projectId, kind, name, unit);
    if (!res.ok) return setMessage({ kind: "error", text: res.message });
    setMasters((m) => ({ ...m, [kind]: [...m[kind], res.item].sort((a, b) => a.name.localeCompare(b.name, "id")) }));
    if (kind === "material") set((f) => ({ ...f, materials: [...f.materials, { master_item_id: res.item.id, quantity: "" }] }));
  }

  const leafById = useMemo(() => new Map(props.leaves.map((l) => [l.id, l])), [props.leaves]);

  return (
    <div className="flex flex-col gap-4 pb-28">
      {props.revision && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Pengawas meminta revisi</p>
          {props.revision.note && <p className="mt-1 text-amber-900">{props.revision.note}</p>}
          {props.revision.comments.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
              {props.revision.comments.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{SECTION_LABEL[c.section] ?? c.section}:</span> {c.comment}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {localDraft && (
        <div className="flex flex-col gap-2 rounded-2xl border border-sky-300 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-sky-900">Ada isian di perangkat ini yang belum tersimpan.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              onClick={() => {
                setForm(localDraft);
                dirty.current = true;
                setLocalDraft(null);
              }}
            >
              Pulihkan
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              onClick={() => {
                clearLocal();
                setLocalDraft(null);
              }}
            >
              Buang
            </Button>
          </div>
        </div>
      )}

      <Section title="Cuaca" comment={comments.cuaca}>
        {WEATHER_SLOTS.map(({ slot, label }) => {
          const w = form.weather[slot];
          return (
            <div key={slot} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{label}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Cuaca ${label}`}>
                {WEATHER_CONDS.map(({ cond, label: cl }) => (
                  <button
                    key={cond}
                    type="button"
                    role="radio"
                    aria-checked={w.condition === cond}
                    onClick={() =>
                      set((f) => ({ ...f, weather: { ...f.weather, [slot]: { ...f.weather[slot], condition: cond } } }))
                    }
                    className={`h-12 rounded-lg border text-base font-medium ${w.condition === cond ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"}`}
                  >
                    {cl}
                  </button>
                ))}
              </div>
              {w.condition === "hujan" && (
                <label className="flex items-center gap-2 text-sm">
                  Lama hujan
                  <input
                    inputMode="decimal"
                    value={w.rain_hours}
                    onChange={(e) =>
                      set((f) => ({ ...f, weather: { ...f.weather, [slot]: { ...f.weather[slot], rain_hours: e.target.value } } }))
                    }
                    className={`${inputCls} w-24`}
                    aria-label={`Jam hujan ${label}`}
                  />
                  jam
                </label>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Tenaga kerja" comment={comments.tenaga_kerja}>
        {masters.labor.length === 0 && <p className="text-sm text-zinc-600">Belum ada kategori.</p>}
        <ul className="flex flex-col gap-2">
          {masters.labor.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3">
              <span>{m.name}</span>
              <Stepper
                value={form.labor[m.id] ?? ""}
                onChange={(v) => set((f) => ({ ...f, labor: { ...f.labor, [m.id]: v } }))}
                label={m.name}
              />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => void quickAdd("labor")}>+ Kategori baru</AddButton>
      </Section>

      <Section title="Alat" comment={comments.alat}>
        {masters.equipment.length === 0 && <p className="text-sm text-zinc-600">Belum ada alat.</p>}
        <ul className="flex flex-col gap-3">
          {masters.equipment.map((m) => {
            const e = form.equipment[m.id] ?? { count: "", hours: "" };
            const used = num(e.count) > 0;
            return (
              <li key={m.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span>{m.name}</span>
                  <Stepper
                    value={e.count}
                    onChange={(v) => set((f) => ({ ...f, equipment: { ...f.equipment, [m.id]: { ...e, count: v } } }))}
                    label={m.name}
                  />
                </div>
                {used && (
                  <label className="flex items-center justify-end gap-2 text-sm text-zinc-700">
                    Jam operasi
                    <input
                      inputMode="decimal"
                      value={e.hours}
                      onChange={(ev) =>
                        set((f) => ({ ...f, equipment: { ...f.equipment, [m.id]: { ...e, hours: ev.target.value } } }))
                      }
                      className={`${inputCls} w-24`}
                      aria-label={`Jam operasi ${m.name}`}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <AddButton onClick={() => void quickAdd("equipment")}>+ Alat baru</AddButton>
      </Section>

      <Section title="Material masuk" comment={comments.material}>
        {form.materials.map((m, i) => {
          const master = masters.material.find((x) => x.id === m.master_item_id);
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={m.master_item_id}
                onChange={(e) =>
                  set((f) => ({ ...f, materials: f.materials.map((x, j) => (j === i ? { ...x, master_item_id: e.target.value } : x)) }))
                }
                className={`${inputCls} min-w-0 flex-1`}
                aria-label="Material"
              >
                <option value="">Pilih material</option>
                {masters.material.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <input
                inputMode="decimal"
                value={m.quantity}
                placeholder="Jumlah"
                onChange={(e) =>
                  set((f) => ({ ...f, materials: f.materials.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) }))
                }
                className={`${inputCls} w-24`}
                aria-label="Jumlah material"
              />
              <span className="w-12 text-sm text-zinc-600">{master?.unit ?? ""}</span>
              <button
                type="button"
                onClick={() => set((f) => ({ ...f, materials: f.materials.filter((_, j) => j !== i) }))}
                className="h-12 px-2 text-red-700"
                aria-label="Hapus baris material"
              >
                ✕
              </button>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <AddButton
            onClick={() => set((f) => ({ ...f, materials: [...f.materials, { master_item_id: "", quantity: "" }] }))}
          >
            + Baris material
          </AddButton>
          <AddButton onClick={() => void quickAdd("material")}>+ Material baru</AddButton>
        </div>
      </Section>

      <Section title="Volume pekerjaan" comment={comments.volume}>
        {form.volumes.length === 0 && (
          <p className="text-sm text-zinc-600">Cari item BOQ yang dikerjakan, lalu isi volumenya.</p>
        )}
        <ul className="flex flex-col gap-3">
          {form.volumes.map((v, i) => {
            const leaf = leafById.get(v.boq_item_id);
            return (
              <li key={v.boq_item_id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                <div>
                  {leaf?.path && <p className="text-xs text-zinc-500">{leaf.path}</p>}
                  <p className="font-medium">
                    {leaf?.code && <span className="mr-1 font-mono text-zinc-500">{leaf.code}</span>}
                    {leaf?.name ?? "Item tidak ditemukan"}
                  </p>
                  {leaf?.contract_volume !== null && leaf?.contract_volume !== undefined && (
                    <p className="text-xs text-zinc-500">
                      Volume kontrak {formatNumber(leaf.contract_volume)} {leaf.unit}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={v.volume}
                    placeholder="0"
                    onChange={(e) =>
                      set((f) => ({ ...f, volumes: f.volumes.map((x, j) => (j === i ? { ...x, volume: e.target.value } : x)) }))
                    }
                    className={`${inputCls} w-32`}
                    aria-label={`Volume ${leaf?.name ?? ""}`}
                  />
                  <span className="text-zinc-700">{leaf?.unit}</span>
                  <button
                    type="button"
                    onClick={() => set((f) => ({ ...f, volumes: f.volumes.filter((_, j) => j !== i) }))}
                    className="ml-auto h-12 px-2 text-sm text-red-700"
                  >
                    Hapus
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <BoqPicker
          leaves={props.leaves}
          exclude={new Set(form.volumes.map((v) => v.boq_item_id))}
          onPick={(id) => set((f) => ({ ...f, volumes: [...f.volumes, { boq_item_id: id, volume: "" }] }))}
        />
      </Section>

      <Section title="Kendala / catatan" comment={comments.catatan}>
        <textarea
          value={form.notes_raw}
          onChange={(e) => set((f) => ({ ...f, notes_raw: e.target.value }))}
          rows={4}
          placeholder="Tulis singkat saja, mis. hujan jam 2 siang, cor ditunda"
          className="w-full rounded-lg border border-zinc-300 p-3 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20"
          aria-label="Kendala atau catatan"
        />
      </Section>

      <Section title="Foto" comment={comments.foto}>
        <PhotoSection
          photos={props.photos}
          basePath={props.basePath}
          reportId={reportId}
          onCountChange={onPhotoCount}
        />
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          {message && (
            message.kind === "error" ? (
              <FormError message={message.text} />
            ) : (
              <p role="status" className="text-sm text-emerald-800">
                {message.text}
              </p>
            )
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={save} disabled={saving || submitting}>
              {saving ? "Menyimpan…" : "Simpan draft"}
            </Button>
            <Button type="button" onClick={submit} disabled={saving || submitting}>
              {submitting ? "Mengirim…" : "Kirim ke Pengawas"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const n = Number(value) || 0;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(String(Math.max(0, n - 1)))}
        className="size-12 rounded-lg border border-zinc-300 bg-white text-xl"
        aria-label={`Kurangi ${label}`}
      >
        −
      </button>
      <input
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        className={`${inputCls} w-16 text-center`}
        aria-label={`Jumlah ${label}`}
      />
      <button
        type="button"
        onClick={() => onChange(String(n + 1))}
        className="size-12 rounded-lg border border-zinc-300 bg-white text-xl"
        aria-label={`Tambah ${label}`}
      >
        +
      </button>
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-lg px-2 py-2 text-sm font-medium text-zinc-800 underline"
    >
      {children}
    </button>
  );
}

function BoqPicker({
  leaves,
  exclude,
  onPick,
}: {
  leaves: BoqLeaf[];
  exclude: Set<string>;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return leaves
      .filter((l) => !exclude.has(l.id))
      .filter((l) => {
        const hay = `${l.code ?? ""} ${l.name} ${l.spec ?? ""} ${l.path}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 20);
  }, [q, leaves, exclude]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari item BOQ, mis. “plesteran lt 2”"
        className={inputCls}
        aria-label="Cari item BOQ"
      />
      {results.length > 0 && (
        <ul className="flex max-h-80 flex-col overflow-auto rounded-lg border border-zinc-200">
          {results.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(l.id);
                  setQ("");
                }}
                className="w-full border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50"
              >
                <span className="block text-xs text-zinc-500">{l.path}</span>
                <span className="font-medium">
                  {l.code && <span className="mr-1 font-mono text-zinc-500">{l.code}</span>}
                  {l.name}
                </span>
                {l.unit && <span className="text-sm text-zinc-600"> · {l.unit}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && results.length === 0 && <p className="text-sm text-zinc-600">Tidak ada item yang cocok.</p>}
    </div>
  );
}
