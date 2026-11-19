"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getProjectWorkspaceSlug } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type JoinCodeState =
  | { status: "idle" }
  | { status: "pending" | "active"; projectName: string; workspaceName: string }
  | { status: "error"; message: string; code?: string };

export async function joinByCode(_prev: JoinCodeState, formData: FormData): Promise<JoinCodeState> {
  await requireUser();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(code)) {
    return { status: "error", message: "Kode proyek terdiri dari 8 karakter (angka 0–9 dan huruf A–F).", code };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_join_by_code", { p_code: code });
  const row = (data as { project_name: string; workspace_name: string; status: "pending" | "active" }[] | null)?.[0];

  if (error || !row) {
    return { status: "error", message: "Kode proyek tidak ditemukan. Cek lagi ke Admin proyekmu.", code };
  }

  return { status: row.status, projectName: row.project_name, workspaceName: row.workspace_name };
}

export async function acceptInvite(token: string) {
  await requireUser();
  const supabase = await createClient();
  const { data: projectId, error } = await supabase.rpc("accept_project_invite", {
    p_token: token,
  });
  if (error || typeof projectId !== "string") {
    redirect(`/join/${encodeURIComponent(token)}?error=1`);
  }

  const slug = await getProjectWorkspaceSlug(projectId);
  redirect(slug ? `/w/${slug}/p/${projectId}` : "/");
}
