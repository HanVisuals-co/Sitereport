"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { assertProjectAdmin } from "@/lib/auth/guards";
import { MASTER_DEFAULTS, type MasterKind } from "@/lib/master/data";
import { createClient } from "@/lib/supabase/server";

const kindSchema = z.enum(["labor", "equipment", "material"]);

export type MasterFormState = { error?: string; ok?: number };

export async function addMasterItem(
  slug: string,
  projectId: string,
  kind: MasterKind,
  _prev: MasterFormState,
  formData: FormData,
): Promise<MasterFormState> {
  await assertProjectAdmin(slug, projectId);
  if (!kindSchema.safeParse(kind).success) return { error: "Jenis tidak valid." };

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  if (!name) return { error: "Nama wajib diisi." };
  if (name.length > 200 || unit.length > 40) return { error: "Nama atau satuan terlalu panjang." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("master_items")
    .insert({ project_id: projectId, kind, name, unit: unit || null });
  if (error) {
    return { error: error.code === "23505" ? `“${name}” sudah ada di daftar.` : "Gagal menambah." };
  }
  refresh();
  return { ok: Date.now() };
}

export async function setMasterItemActive(
  slug: string,
  projectId: string,
  itemId: string,
  active: boolean,
) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("master_items")
    .update({ active })
    .eq("id", itemId)
    .eq("project_id", projectId);
  if (error) throw new Error("Gagal mengubah status.");
  refresh();
}

/** Isi daftar dengan item umum; item yang namanya sudah ada dilewati. */
export async function seedMasterDefaults(slug: string, projectId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("master_items")
    .select("kind, name")
    .eq("project_id", projectId);
  if (readError) throw new Error("Gagal membaca daftar.");

  const taken = new Set(
    (existing as { kind: string; name: string }[]).map((r) => `${r.kind}:${r.name.toLowerCase()}`),
  );
  const rows = (Object.keys(MASTER_DEFAULTS) as MasterKind[]).flatMap((kind) =>
    MASTER_DEFAULTS[kind]
      .filter((d) => !taken.has(`${kind}:${d.name.toLowerCase()}`))
      .map((d) => ({ project_id: projectId, kind, name: d.name, unit: d.unit })),
  );
  if (rows.length === 0) return;

  const { error } = await supabase.from("master_items").insert(rows);
  if (error) throw new Error("Gagal mengisi daftar awal.");
  refresh();
}
