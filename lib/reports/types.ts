// Tipe & label laporan yang dipakai server dan klien.

export type ReportStatus = "draft" | "submitted" | "revision_requested" | "approved";
export type WeatherSlot = "pagi" | "siang" | "sore";
export type WeatherCond = "cerah" | "berawan" | "hujan";

export const WEATHER_SLOTS: { slot: WeatherSlot; label: string }[] = [
  { slot: "pagi", label: "Pagi" },
  { slot: "siang", label: "Siang" },
  { slot: "sore", label: "Sore" },
];

export const WEATHER_CONDS: { cond: WeatherCond; label: string }[] = [
  { cond: "cerah", label: "Cerah" },
  { cond: "berawan", label: "Berawan" },
  { cond: "hujan", label: "Hujan" },
];

export const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: "Draft",
  submitted: "Menunggu review",
  revision_requested: "Perlu revisi",
  approved: "Disetujui",
};

export const STATUS_CLASS: Record<ReportStatus, string> = {
  draft: "bg-zinc-200 text-zinc-800",
  submitted: "bg-sky-100 text-sky-900",
  revision_requested: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
};

export const SECTION_LABEL: Record<string, string> = {
  cuaca: "Cuaca",
  tenaga_kerja: "Tenaga kerja",
  alat: "Alat",
  material: "Material",
  volume: "Volume pekerjaan",
  catatan: "Catatan",
  foto: "Foto",
};

/** Payload simpan draft; cocok dengan public.save_report_draft. */
export type DraftPayload = {
  notes_raw: string;
  notes_polished: string;
  weather: { slot: WeatherSlot; condition: WeatherCond; rain_hours: number }[];
  labor: { master_item_id: string; count: number }[];
  equipment: { master_item_id: string; count: number; hours: number }[];
  materials: { master_item_id: string; quantity: number }[];
  volumes: { boq_item_id: string; volume: number }[];
};

export type ReportPhoto = {
  id: string;
  storage_path: string;
  source: "camera" | "gallery";
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  url: string | null;
  dup_flag: boolean;
  dup_resolution: "valid" | "duplicate" | null;
};

export type BoqLeaf = {
  id: string;
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  contract_volume: number | null;
  path: string;
};

export function formatPeriod(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
  const s = fmt.format(new Date(`${start}T00:00:00Z`));
  if (start === end) return s;
  return `${s} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}
