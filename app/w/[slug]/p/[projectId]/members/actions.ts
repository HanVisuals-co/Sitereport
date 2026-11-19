"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { assertProjectAdmin } from "@/lib/auth/guards";
import { type ProjectRole } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

function parseRole(value: FormDataEntryValue | null): ProjectRole | null {
  return value === "pengawas" || value === "pelaksana" ? value : null;
}

export type InviteState =
  | { status: "idle" }
  | { status: "created"; link: string; role: ProjectRole }
  | { status: "error"; message: string };

export async function createInvite(
  slug: string,
  projectId: string,
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  await assertProjectAdmin(slug, projectId);
  const role = parseRole(formData.get("role"));
  if (!role) return { status: "error", message: "Pilih peran undangan." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_project_invite", {
    p_project_id: projectId,
    p_role: role,
  });
  if (error || typeof data !== "string") {
    return { status: "error", message: "Gagal membuat undangan. Coba lagi." };
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  refresh();
  return { status: "created", link: `${origin}/join/${data}`, role };
}

export async function revokeInvite(slug: string, projectId: string, inviteId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_project_invite", { p_invite_id: inviteId });
  if (error) throw new Error("Gagal mencabut undangan");
  refresh();
}

export async function approveRequest(
  slug: string,
  projectId: string,
  userId: string,
  formData: FormData,
) {
  await assertProjectAdmin(slug, projectId);
  const role = parseRole(formData.get("role"));
  if (!role) throw new Error("Peran tidak valid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_join_request", {
    p_project_id: projectId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error("Gagal menyetujui permintaan");
  refresh();
}

export async function rejectRequest(slug: string, projectId: string, userId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_join_request", {
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (error) throw new Error("Gagal menolak permintaan");
  refresh();
}

export async function changeRole(
  slug: string,
  projectId: string,
  userId: string,
  formData: FormData,
) {
  await assertProjectAdmin(slug, projectId);
  const role = parseRole(formData.get("role"));
  if (!role) throw new Error("Peran tidak valid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new Error("Gagal mengubah peran");
  refresh();
}

export async function removeMember(slug: string, projectId: string, userId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error("Gagal mengeluarkan anggota");
  refresh();
}

export async function regenerateCode(slug: string, projectId: string) {
  await assertProjectAdmin(slug, projectId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_join_code", { p_project_id: projectId });
  if (error) throw new Error("Gagal mengganti kode proyek");
  refresh();
}
