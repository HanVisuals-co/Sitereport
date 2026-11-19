import "server-only";

import { requireUser } from "@/lib/auth/session";
import { getProject, getWorkspace, isUuid } from "@/lib/data";

/** Pastikan user adalah Admin workspace pemilik proyek. Dipakai di server action. */
export async function assertProjectAdmin(slug: string, projectId: string) {
  if (!isUuid(projectId)) throw new Error("Proyek tidak valid");
  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws?.isAdmin || !project || project.workspace_id !== ws.workspace.id) {
    throw new Error("Hanya Admin yang bisa melakukan ini");
  }
  return { user, workspace: ws.workspace, project };
}
