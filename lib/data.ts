import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type Workspace = { id: string; name: string; slug: string };

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  code: string | null;
  location: string | null;
  timezone: string;
  status: "active" | "archived";
  report_period_days: number;
  backdate_limit_days: number;
  reminder_time: string;
  join_code: string;
  start_date: string | null;
  end_date: string | null;
};

export type ProjectRole = "pengawas" | "pelaksana" | "viewer";

export type Membership = {
  role: ProjectRole;
  project: Pick<Project, "id" | "name" | "status"> & { workspace: Workspace };
};

/** Workspace tempat user menjadi Admin. */
export async function listAdminWorkspaces(userId: string): Promise<Workspace[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_admins")
    .select("workspace:workspaces(id, name, slug)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data as unknown as { workspace: Workspace }[])
    .map((r) => r.workspace)
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/** Proyek tempat user menjadi anggota aktif (Pengawas/Pelaksana/Viewer). */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("role, project:projects(id, name, status, workspace:workspaces(id, name, slug))")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return data as unknown as Membership[];
}

/** Workspace berdasarkan slug, plus apakah user Admin. Null kalau tidak terlihat oleh user. */
async function getWorkspaceUncached(
  slug: string,
  userId: string,
): Promise<{ workspace: Workspace; isAdmin: boolean } | null> {
  const supabase = await createClient();
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle<Workspace>();
  if (error) throw error;
  if (!workspace) return null;

  // RLS: baris workspace_admins hanya terlihat oleh Admin workspace itu.
  const { count, error: adminError } = await supabase
    .from("workspace_admins")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .eq("user_id", userId);
  if (adminError) throw adminError;

  return { workspace, isAdmin: (count ?? 0) > 0 };
}

/** Proyek di workspace yang terlihat oleh user (Admin: semua; anggota: proyeknya saja). */
export async function listProjects(workspaceId: string): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("status")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

async function getProjectUncached(projectId: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<Project>();
  if (error) throw error;
  return data;
}

/** Jumlah anggota aktif per peran, plus permintaan bergabung yang menunggu. */
export async function countMembers(
  projectId: string,
): Promise<Record<ProjectRole | "pending", number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("role, status")
    .eq("project_id", projectId);
  if (error) throw error;
  const counts = { pengawas: 0, pelaksana: 0, viewer: 0, pending: 0 };
  for (const row of data as { role: ProjectRole; status: MemberStatus }[]) {
    if (row.status === "pending") counts.pending++;
    else counts[row.role]++;
  }
  return counts;
}

export type MemberStatus = "pending" | "active";

export type ProjectMember = {
  user_id: string;
  role: ProjectRole;
  status: MemberStatus;
  created_at: string;
  profile: { full_name: string | null; email: string | null } | null;
};

/** Semua anggota proyek (aktif dan pending). Pending hanya terlihat oleh Admin. */
export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select(
      "user_id, role, status, created_at, profile:profiles!project_members_user_id_fkey(full_name, email)",
    )
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw error;
  return data as unknown as ProjectMember[];
}

export type ProjectInvite = {
  id: string;
  role: ProjectRole;
  expires_at: string;
  max_uses: number | null;
  used_count: number;
  created_at: string;
};

/** Undangan yang masih berlaku (belum dicabut, belum kedaluwarsa, kuota belum habis). */
export async function listActiveInvites(projectId: string): Promise<ProjectInvite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_invites")
    .select("id, role, expires_at, max_uses, used_count, created_at")
    .eq("project_id", projectId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProjectInvite[]).filter((i) => i.max_uses === null || i.used_count < i.max_uses);
}

export type PendingJoinRequest = {
  project_name: string;
  workspace_name: string;
  requested_at: string;
};

export async function listMyPendingRequests(): Promise<PendingJoinRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_join_requests");
  if (error) throw error;
  return data as PendingJoinRequest[];
}

/** Slug workspace dari sebuah proyek yang bisa dibaca user. */
export async function getProjectWorkspaceSlug(projectId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("workspace:workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as { workspace: { slug: string } } | null)?.workspace.slug ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export const ROLE_LABEL: Record<ProjectRole, string> = {
  pengawas: "Pengawas",
  pelaksana: "Pelaksana",
  viewer: "Viewer",
};

export const TIMEZONE_LABEL: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

/** Dipanggil berkali-kali per request (layout + halaman); hasilnya dibagi lewat cache(). */
export const getWorkspace = cache(getWorkspaceUncached);

/** Dipanggil berkali-kali per request (layout + halaman); hasilnya dibagi lewat cache(). */
export const getProject = cache(getProjectUncached);
