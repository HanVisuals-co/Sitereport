import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { countBoqItems, isBoqUsed } from "@/lib/boq/data";
import { getProject, getWorkspace, isUuid } from "@/lib/data";

import { BoqImporter } from "./boq-importer";

export const metadata: Metadata = { title: "Import BOQ · SiteReport" };

export default async function BoqImportPage(
  props: PageProps<"/w/[slug]/p/[projectId]/boq/import">,
) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws?.isAdmin || !project || project.workspace_id !== ws.workspace.id) notFound();

  const [existing, used] = await Promise.all([countBoqItems(project.id), isBoqUsed(project.id)]);

  return (
    <>
      <div>
        <Link href={`/w/${slug}/p/${project.id}/boq`} className="text-sm text-zinc-600 hover:underline">
          ← BOQ {project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Import BOQ dari Excel</h1>
        <p className="text-zinc-600">
          Pilih file RAB (.xlsx). File dibaca di perangkatmu; yang dikirim ke server hanya item
          BOQ yang kamu setujui.
        </p>
      </div>

      {used ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          BOQ proyek ini sudah dipakai di laporan, jadi tidak bisa diimport ulang. Ubah item satu
          per satu dari halaman BOQ.
        </p>
      ) : (
        <BoqImporter slug={slug} projectId={project.id} existingCount={existing} />
      )}
    </>
  );
}
