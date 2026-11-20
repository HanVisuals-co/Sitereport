import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { SmallSubmit } from "@/components/ui/confirm-submit";
import { requireUser } from "@/lib/auth/session";
import { getProject, getWorkspace, isUuid } from "@/lib/data";
import { listMasterItems, MASTER_KINDS } from "@/lib/master/data";

import { seedMasterDefaults, setMasterItemActive } from "./actions";
import { AddMasterForm } from "./add-master-form";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export const metadata: Metadata = { title: "Daftar master · SiteReport" };

export default async function MasterPage(props: PageProps<"/w/[slug]/p/[projectId]/master">) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) notFound();

  const items = await listMasterItems(project.id);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <BackLink href={`/w/${slug}/p/${project.id}`}>{project.name}</BackLink>
          <h1 className="mt-2 text-2xl font-semibold">Daftar master</h1>
          <p className="text-zinc-600">
            Pilihan tenaga kerja, alat, dan material di form laporan harian. Pelaksana juga bisa
            menambah langsung dari form.
          </p>
        </div>
        {ws.isAdmin && (
          <form action={seedMasterDefaults.bind(null, slug, project.id)}>
            <SmallSubmit>Isi dengan daftar umum</SmallSubmit>
          </form>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {MASTER_KINDS.map(({ kind, label, unitHint }) => {
          const list = items.filter((i) => i.kind === kind);
          return (
            <section
              key={kind}
              className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-lg font-semibold">
                {label} <span className="text-sm font-normal text-zinc-500">({list.filter((i) => i.active).length})</span>
              </h2>
              {ws.isAdmin && (
                <AddMasterForm slug={slug} projectId={project.id} kind={kind} unitHint={unitHint} />
              )}
              {list.length === 0 ? (
                <p className="text-sm text-zinc-600">Belum ada.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {list.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className={`text-sm ${it.active ? "" : "text-zinc-400 line-through"}`}>
                        {it.name}
                        {it.unit && <span className="text-zinc-500"> · {it.unit}</span>}
                      </span>
                      {ws.isAdmin && (
                        <form action={setMasterItemActive.bind(null, slug, project.id, it.id, !it.active)}>
                          <button
                            type="submit"
                            className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
                          >
                            {it.active ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
