import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { buttonClass } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { requireUser } from "@/lib/auth/session";
import { isBoqUsed, listBoqItems, listBoqPrices } from "@/lib/boq/data";
import { getProject, getWorkspace, isUuid } from "@/lib/data";

import { clearBoq } from "./actions";
import { BoqTree } from "./boq-tree";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export const metadata: Metadata = { title: "BOQ · SiteReport" };

export default async function BoqPage(props: PageProps<"/w/[slug]/p/[projectId]/boq">) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) notFound();

  const [items, prices, used] = await Promise.all([
    listBoqItems(project.id),
    ws.isAdmin ? listBoqPrices(project.id) : Promise.resolve({}),
    ws.isAdmin ? isBoqUsed(project.id) : Promise.resolve(true),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <BackLink href={`/w/${slug}/p/${project.id}`}>{project.name}</BackLink>
          <h1 className="mt-2 text-2xl font-semibold">BOQ</h1>
          <p className="text-zinc-600">
            {items.length === 0
              ? "Belum ada BOQ."
              : `${items.length.toLocaleString("id-ID")} baris`}
          </p>
        </div>
        {ws.isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/w/${slug}/p/${project.id}/boq/import`} className={buttonClass("primary")}>
              {items.length === 0 ? "Import dari Excel" : "Import ulang"}
            </Link>
            {items.length > 0 && !used && (
              <form action={clearBoq.bind(null, slug, project.id)}>
                <ConfirmSubmit
                  message="Hapus seluruh BOQ proyek ini? Semua item dan harga akan hilang."
                  className="h-12"
                >
                  Hapus BOQ
                </ConfirmSubmit>
              </form>
            )}
          </div>
        )}
      </div>

      {ws.isAdmin && used && items.length > 0 && (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          BOQ sudah dipakai di laporan. Item yang sudah punya volume laporan tidak bisa dihapus, dan
          BOQ tidak bisa diimport ulang.
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
          <p className="font-medium">BOQ belum diisi.</p>
          <p className="mt-1 text-sm text-zinc-600">
            {ws.isAdmin
              ? "Import langsung dari file RAB Excel (.xlsx). Laporan harian baru bisa dibuat setelah BOQ terisi."
              : "Admin proyek belum mengisi BOQ."}
          </p>
        </div>
      ) : (
        <BoqTree
          items={items}
          prices={prices}
          isAdmin={ws.isAdmin}
          slug={slug}
          projectId={project.id}
        />
      )}
    </>
  );
}
