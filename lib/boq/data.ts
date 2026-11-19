import "server-only";

import { createClient } from "@/lib/supabase/server";

export type BoqItem = {
  id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  contract_volume: number | null;
  weight_pct: number | null;
  sort_order: number;
};

const PAGE = 1000; // batas baris default Supabase per request

/** Semua item BOQ proyek, berurutan. Harga diambil terpisah (hanya Admin yang bisa). */
export async function listBoqItems(projectId: string): Promise<BoqItem[]> {
  const supabase = await createClient();
  const out: BoqItem[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("boq_items")
      .select("id, parent_id, level, code, name, spec, unit, contract_volume, weight_pct, sort_order")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(
      ...(data as BoqItem[]).map((r) => ({
        ...r,
        contract_volume: r.contract_volume === null ? null : Number(r.contract_volume),
        weight_pct: r.weight_pct === null ? null : Number(r.weight_pct),
      })),
    );
    if (data.length < PAGE) break;
  }
  return out;
}

/** Harga satuan per item. RLS mengembalikan kosong untuk non-Admin. */
export async function listBoqPrices(projectId: string): Promise<Record<string, number>> {
  const supabase = await createClient();
  const out: Record<string, number> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("boq_item_prices")
      .select("boq_item_id, unit_price, boq_items!inner(project_id)")
      .eq("boq_items.project_id", projectId)
      .order("boq_item_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data as { boq_item_id: string; unit_price: number }[]) {
      out[r.boq_item_id] = Number(r.unit_price);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

export async function countBoqItems(projectId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("boq_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw error;
  return count ?? 0;
}

/** Apakah BOQ sudah dipakai laporan (tidak bisa diganti/dihapus). */
export async function isBoqUsed(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("report_volumes")
    .select("report_id, boq_items!inner(project_id)", { count: "exact", head: true })
    .eq("boq_items.project_id", projectId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
