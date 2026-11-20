import "server-only";

import { listBoqItems } from "@/lib/boq/data";
import type { ProjectRole } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import type {
  BoqLeaf,
  ReportPhoto,
  ReportStatus,
  WeatherCond,
  WeatherSlot,
} from "./types";

export type ReportSummary = {
  id: string;
  author_id: string;
  period_start: string;
  period_end: string;
  status: ReportStatus;
  is_late: boolean;
  submitted_at: string | null;
  updated_at: string;
  author: { full_name: string | null; email: string | null } | null;
};

export async function getMyRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("role, status")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle<{ role: ProjectRole; status: string }>();
  if (error) throw error;
  return data?.status === "active" ? data.role : null;
}

/** Laporan yang terlihat oleh user (RLS: milik sendiri, atau non-draft untuk Pengawas/Admin). */
export async function listReports(
  projectId: string,
  opts: { authorId?: string; limit?: number } = {},
): Promise<ReportSummary[]> {
  const supabase = await createClient();
  let q = supabase
    .from("reports")
    .select(
      "id, author_id, period_start, period_end, status, is_late, submitted_at, updated_at, author:profiles!reports_author_id_fkey(full_name, email)",
    )
    .eq("project_id", projectId)
    .order("period_start", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.authorId) q = q.eq("author_id", opts.authorId);
  const { data, error } = await q;
  if (error) throw error;
  return data as unknown as ReportSummary[];
}

export type ReportDetail = ReportSummary & {
  project_id: string;
  notes_raw: string | null;
  notes_polished: string | null;
  approved_at: string | null;
  weather: { slot: WeatherSlot; condition: WeatherCond; rain_hours: number }[];
  labor: { master_item_id: string; count: number }[];
  equipment: { master_item_id: string; count: number; hours: number }[];
  materials: { master_item_id: string; quantity: number }[];
  volumes: {
    boq_item_id: string;
    volume: number;
    dup_flag: boolean;
    dup_of_report_id: string | null;
    dup_resolution: "valid" | "duplicate" | null;
  }[];
  photos: ReportPhoto[];
  reviews: {
    id: string;
    action: "approve" | "request_revision" | "reopen";
    note: string | null;
    created_at: string;
    reviewer: { full_name: string | null; email: string | null } | null;
    comments: { section: string; comment: string }[];
  }[];
};

export async function getReport(reportId: string): Promise<ReportDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      `id, project_id, author_id, period_start, period_end, status, is_late, submitted_at, updated_at,
       approved_at, notes_raw, notes_polished,
       author:profiles!reports_author_id_fkey(full_name, email),
       weather:report_weather(slot, condition, rain_hours),
       labor:report_labor(master_item_id, count),
       equipment:report_equipment(master_item_id, count, hours),
       materials:report_materials(master_item_id, quantity),
       volumes:report_volumes!report_volumes_report_id_fkey(boq_item_id, volume, dup_flag, dup_of_report_id, dup_resolution),
       photos:report_photos(id, storage_path, source, taken_at, lat, lng, dup_flag, dup_resolution, created_at),
       reviews:report_reviews(id, action, note, created_at,
         reviewer:profiles!report_reviews_reviewer_id_fkey(full_name, email),
         comments:report_review_comments(section, comment))`,
    )
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const raw = data as unknown as ReportDetail & {
    photos: (Omit<ReportPhoto, "url"> & { created_at: string })[];
  };
  const photos = [...raw.photos].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const urls = await signPhotoUrls(photos.map((p) => p.storage_path));

  return {
    ...raw,
    weather: raw.weather.map((w) => ({ ...w, rain_hours: Number(w.rain_hours) })),
    equipment: raw.equipment.map((e) => ({ ...e, hours: Number(e.hours) })),
    materials: raw.materials.map((m) => ({ ...m, quantity: Number(m.quantity) })),
    volumes: raw.volumes.map((v) => ({ ...v, volume: Number(v.volume) })),
    photos: photos.map((p) => ({ ...p, url: urls[p.storage_path] ?? null })),
    reviews: [...raw.reviews].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

/** Signed URL berumur pendek untuk foto di bucket privat. */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("report-photos")
    .createSignedUrls(paths, 60 * 60);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const d of data) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/** Item BOQ terbawah (yang bisa diisi volume), dengan jalur grupnya. */
export async function listBoqLeaves(projectId: string): Promise<BoqLeaf[]> {
  const items = await listBoqItems(projectId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const hasChild = new Set(items.map((i) => i.parent_id).filter(Boolean));
  const pathCache = new Map<string, string>();
  const pathOf = (id: string | null): string => {
    if (!id) return "";
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    const it = byId.get(id);
    const p = it ? [pathOf(it.parent_id), it.name].filter(Boolean).join(" › ") : "";
    pathCache.set(id, p);
    return p;
  };
  return items
    .filter((i) => !hasChild.has(i.id))
    .map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      spec: i.spec,
      unit: i.unit,
      contract_volume: i.contract_volume,
      path: pathOf(i.parent_id),
    }));
}

/** Tanggal hari ini di zona waktu proyek (YYYY-MM-DD). */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}
