import "server-only";

import { createClient } from "@/lib/supabase/server";

export type MasterKind = "labor" | "equipment" | "material";

export type MasterItem = {
  id: string;
  kind: MasterKind;
  name: string;
  unit: string | null;
  active: boolean;
};

export const MASTER_KINDS: { kind: MasterKind; label: string; unitHint: string }[] = [
  { kind: "labor", label: "Tenaga kerja", unitHint: "orang" },
  { kind: "equipment", label: "Alat", unitHint: "unit" },
  { kind: "material", label: "Material", unitHint: "zak, m3, kg, …" },
];

/** Isian awal yang umum di proyek gedung. Admin bisa menambah atau menonaktifkan. */
export const MASTER_DEFAULTS: Record<MasterKind, { name: string; unit: string | null }[]> = {
  labor: [
    { name: "Mandor", unit: "orang" },
    { name: "Kepala tukang", unit: "orang" },
    { name: "Tukang batu", unit: "orang" },
    { name: "Tukang besi", unit: "orang" },
    { name: "Tukang kayu", unit: "orang" },
    { name: "Tukang las", unit: "orang" },
    { name: "Pekerja", unit: "orang" },
    { name: "Operator alat berat", unit: "orang" },
  ],
  equipment: [
    { name: "Excavator", unit: "unit" },
    { name: "Dump truck", unit: "unit" },
    { name: "Concrete mixer", unit: "unit" },
    { name: "Concrete vibrator", unit: "unit" },
    { name: "Stamper", unit: "unit" },
    { name: "Tower crane", unit: "unit" },
    { name: "Concrete pump", unit: "unit" },
    { name: "Scaffolding", unit: "set" },
  ],
  material: [
    { name: "Semen", unit: "zak" },
    { name: "Pasir", unit: "m3" },
    { name: "Batu split", unit: "m3" },
    { name: "Besi beton", unit: "kg" },
    { name: "Beton ready mix", unit: "m3" },
    { name: "Bata ringan", unit: "m3" },
    { name: "Kayu bekisting", unit: "m3" },
    { name: "Multiplek", unit: "lembar" },
  ],
};

export async function listMasterItems(projectId: string): Promise<MasterItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("master_items")
    .select("id, kind, name, unit, active")
    .eq("project_id", projectId)
    .order("name");
  if (error) throw error;
  return data as MasterItem[];
}

export async function countMasterItems(projectId: string): Promise<Record<MasterKind, number>> {
  const items = await listMasterItems(projectId);
  const counts: Record<MasterKind, number> = { labor: 0, equipment: 0, material: 0 };
  for (const it of items) if (it.active) counts[it.kind]++;
  return counts;
}
