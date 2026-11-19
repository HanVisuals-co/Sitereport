"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { assertProjectAdmin } from "@/lib/auth/guards";
import { toNumber, type ImportItem } from "@/lib/boq/parse";
import { createClient } from "@/lib/supabase/server";

const importItemSchema = z.object({
  key: z.string().min(1).max(40),
  parent_key: z.string().min(1).max(40).nullable(),
  level: z.number().int().min(1).max(6),
  code: z.string().max(40).nullable(),
  name: z.string().min(1).max(500),
  spec: z.string().max(4000).nullable(),
  unit: z.string().max(40).nullable(),
  volume: z.number().finite().min(0).nullable(),
  unit_price: z.number().finite().min(0).nullable(),
});

export type ImportResult = { ok: true } | { ok: false; message: string };

export async function importBoq(
  slug: string,
  projectId: string,
  items: ImportItem[],
  replace: boolean,
): Promise<ImportResult> {
  await assertProjectAdmin(slug, projectId);

  const parsed = z.array(importItemSchema).min(1).max(5000).safeParse(items);
  if (!parsed.success) {
    return { ok: false, message: "Data BOQ tidak valid. Coba baca ulang file-nya." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("import_boq", {
    p_project_id: projectId,
    p_items: parsed.data,
    p_replace: replace,
  });

  if (error) {
    const message =
      error.code === "23503"
        ? "BOQ sudah dipakai di laporan, jadi tidak bisa diganti."
        : error.code === "23505"
          ? "Proyek ini sudah punya BOQ. Centang “Ganti BOQ lama” untuk menimpanya."
          : "Gagal menyimpan BOQ. Coba lagi.";
    return { ok: false, message };
  }

  redirect(`/w/${slug}/p/${projectId}/boq`);
}

export async function clearBoq(slug: string, projectId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_boq", { p_project_id: projectId });
  if (error) {
    throw new Error(
      error.code === "23503" ? "BOQ sudah dipakai laporan dan tidak bisa dihapus." : "Gagal menghapus BOQ.",
    );
  }
  refresh();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const optionalNumber = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = toNumber(v);
    if (n === null || n < 0) {
      ctx.addIssue({ code: "custom", message: "Isi angka 0 atau lebih." });
      return z.NEVER;
    }
    return n;
  });

const itemFormSchema = z.object({
  name: z.string().trim().min(1, "Uraian wajib diisi.").max(500),
  code: optionalText(40),
  spec: optionalText(4000),
  unit: optionalText(40),
  volume: optionalNumber,
  unit_price: optionalNumber,
});

export type ItemFormState = { ok?: boolean; error?: string };

function readItemForm(formData: FormData) {
  return itemFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    spec: String(formData.get("spec") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    volume: String(formData.get("volume") ?? ""),
    unit_price: String(formData.get("unit_price") ?? ""),
  });
}

export async function updateBoqItem(
  slug: string,
  projectId: string,
  itemId: string,
  isLeaf: boolean,
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  await assertProjectAdmin(slug, projectId);
  const parsed = readItemForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("boq_items")
    .update({
      name: v.name,
      code: v.code,
      spec: v.spec,
      // Grup tidak punya satuan/volume.
      unit: isLeaf ? v.unit : null,
      contract_volume: isLeaf ? v.volume : null,
    })
    .eq("id", itemId)
    .eq("project_id", projectId);
  if (error) return { error: "Gagal menyimpan item." };

  if (isLeaf) {
    const prices = supabase.from("boq_item_prices");
    const { error: priceError } =
      v.unit_price === null
        ? await prices.delete().eq("boq_item_id", itemId)
        : await prices.upsert({ boq_item_id: itemId, unit_price: v.unit_price });
    if (priceError) return { error: "Item tersimpan, tapi harga gagal disimpan." };
  }

  refresh();
  return { ok: true };
}

export async function addBoqItem(
  slug: string,
  projectId: string,
  parentId: string | null,
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  await assertProjectAdmin(slug, projectId);
  const parsed = readItemForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_boq_item", {
    p_project_id: projectId,
    p_parent_id: parentId,
    p_name: v.name,
    p_code: v.code,
    p_spec: v.spec,
    p_unit: v.unit,
    p_volume: v.volume,
    p_unit_price: v.unit_price,
  });
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Item ini sudah punya volume di laporan, tidak bisa diberi sub-item."
          : error.code === "22023"
            ? "BOQ maksimal 6 level."
            : "Gagal menambah item.",
    };
  }
  refresh();
  return { ok: true };
}

export async function deleteBoqItem(slug: string, projectId: string, itemId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("boq_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(
      error.code === "23503"
        ? "Item ini (atau sub-itemnya) sudah dipakai laporan dan tidak bisa dihapus."
        : "Gagal menghapus item.",
    );
  }
  refresh();
}
