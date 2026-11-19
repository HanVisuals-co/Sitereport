import "server-only";

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
export async function getWorkspace(
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

export async function getProject(projectId: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<Project>();
  if (error) throw error;
  return data;
}

export async function countMembers(projectId: string): Promise<Record<ProjectRole, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("status", "active");
  if (error) throw error;
  const counts: Record<ProjectRole, number> = { pengawas: 0, pelaksana: 0, viewer: 0 };
  for (const row of data as { role: ProjectRole }[]) counts[row.role]++;
  return counts;
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
