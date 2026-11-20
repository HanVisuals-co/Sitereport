import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getWorkspace, listProjects, TIMEZONE_LABEL } from "@/lib/data";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export default async function WorkspacePage(props: PageProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const user = await requireUser();
  const result = await getWorkspace(slug, user.id);
  if (!result) notFound();

  const { workspace, isAdmin } = result;
  const projects = await listProjects(workspace.id);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Proyek</h1>
          <p className="text-zinc-600">
            {projects.length === 0 ? "Belum ada proyek." : `${projects.length} proyek`}
          </p>
        </div>
        {isAdmin && (
          <Link href={`/w/${workspace.slug}/projects/new`} className={buttonClass("primary")}>
            + Proyek baru
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
          <p className="font-medium">Mulai dengan membuat proyek pertama.</p>
          <p className="mt-1 text-sm text-zinc-600">
            Setelah proyek dibuat, kamu bisa mengisi BOQ dan mengundang Pengawas serta Pelaksana.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/w/${workspace.slug}/p/${p.id}`}
                className="flex h-full flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 active:scale-[0.99] active:bg-zinc-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.status === "archived" && (
                    <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">
                      Arsip
                    </span>
                  )}
                </div>
                <span className="text-sm text-zinc-600">
                  {[p.code, p.location, TIMEZONE_LABEL[p.timezone]].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
