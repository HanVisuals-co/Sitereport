"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { getProject, getWorkspace, isUuid } from "@/lib/data";
import type { DraftPayload } from "@/lib/reports/types";
import { createClient } from "@/lib/supabase/server";

/** Anggota proyek di workspace slug. RLS tetap menjadi penjaga utama. */
async function assertMember(slug: string, projectId: string) {
  if (!isUuid(projectId)) throw new Error("Proyek tidak valid");
  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) {
    throw new Error("Proyek tidak ditemukan");
  }
  return { user, project };
}

export type StartState = { error?: string };

export async function startReport(
  slug: string,
  projectId: string,
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  await assertMember(slug, projectId);
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pilih tanggal laporan." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_report", {
    p_project_id: projectId,
    p_date: date,
  });
  if (error || typeof data !== "string") {
    return { error: error?.message ?? "Gagal membuat laporan." };
  }
  redirect(`/w/${slug}/p/${projectId}/reports/${data}`);
}

const num = z.number().finite().min(0);
const draftSchema = z.object({
  notes_raw: z.string().max(10000),
  notes_polished: z.string().max(10000),
  weather: z
    .array(
      z.object({
        slot: z.enum(["pagi", "siang", "sore"]),
        condition: z.enum(["cerah", "berawan", "hujan"]),
        rain_hours: num.max(24),
      }),
    )
    .max(3),
  labor: z.array(z.object({ master_item_id: z.uuid(), count: z.number().int().min(0).max(100000) })).max(500),
  equipment: z
    .array(z.object({ master_item_id: z.uuid(), count: z.number().int().min(0).max(10000), hours: num.max(10000) }))
    .max(500),
  materials: z.array(z.object({ master_item_id: z.uuid(), quantity: num })).max(500),
  volumes: z.array(z.object({ boq_item_id: z.uuid(), volume: num })).max(2000),
});

export type SaveResult =
  | { ok: true; duplicates?: number; overContract?: { name: string }[] }
  | { ok: false; message: string };

async function save(reportId: string, payload: DraftPayload): Promise<SaveResult> {
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Isian laporan tidak valid. Cek angka yang diisi." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_report_draft", {
    p_report_id: reportId,
    p_data: parsed.data,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function saveDraft(
  slug: string,
  projectId: string,
  reportId: string,
  payload: DraftPayload,
): Promise<SaveResult> {
  await assertMember(slug, projectId);
  if (!isUuid(reportId)) return { ok: false, message: "Laporan tidak valid." };
  return save(reportId, payload);
}

export async function submitReport(
  slug: string,
  projectId: string,
  reportId: string,
  payload: DraftPayload,
): Promise<SaveResult> {
  await assertMember(slug, projectId);
  if (!isUuid(reportId)) return { ok: false, message: "Laporan tidak valid." };

  const saved = await save(reportId, payload);
  if (!saved.ok) return saved;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_report", { p_report_id: reportId });
  if (error) return { ok: false, message: error.message };
  const result = data as { duplicates: number; over_contract: { name: string }[] };
  return { ok: true, duplicates: result.duplicates, overContract: result.over_contract };
}

export type QuickMaster = { id: string; name: string; unit: string | null };

/** Pelaksana menambah item daftar master langsung dari form (diizinkan oleh RLS). */
export async function addMasterQuick(
  slug: string,
  projectId: string,
  kind: "labor" | "equipment" | "material",
  name: string,
  unit: string,
): Promise<{ ok: true; item: QuickMaster } | { ok: false; message: string }> {
  await assertMember(slug, projectId);
  const n = name.trim();
  if (!n || n.length > 200 || unit.length > 40) return { ok: false, message: "Nama tidak valid." };
  if (!["labor", "equipment", "material"].includes(kind)) return { ok: false, message: "Jenis tidak valid." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("master_items")
    .insert({ project_id: projectId, kind, name: n, unit: unit.trim() || null })
    .select("id, name, unit")
    .single<QuickMaster>();
  if (error) {
    return { ok: false, message: error.code === "23505" ? `“${n}” sudah ada.` : "Gagal menambah." };
  }
  return { ok: true, item: data };
}
