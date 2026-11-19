import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import {
  listAdminWorkspaces,
  listMemberships,
  listMyPendingRequests,
  ROLE_LABEL,
} from "@/lib/data";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export default async function Home() {
  const user = await requireUser();
  const [workspaces, memberships, pendingRequests] = await Promise.all([
    listAdminWorkspaces(user.id),
    listMemberships(user.id),
    listMyPendingRequests(),
  ]);

  // Kasus paling umum: Admin dari satu workspace saja.
  if (workspaces.length === 1 && memberships.length === 0 && pendingRequests.length === 0) {
    redirect(`/w/${workspaces[0].slug}`);
  }

  const isNew = workspaces.length === 0 && memberships.length === 0;

  return (
    <>
      <AppHeader title="SiteReport" email={user.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
        {pendingRequests.length > 0 && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h2 className="font-semibold">Menunggu persetujuan Admin</h2>
            <ul className="mt-1 text-sm text-zinc-700">
              {pendingRequests.map((r) => (
                <li key={`${r.workspace_name}-${r.project_name}-${r.requested_at}`}>
                  {r.project_name} · {r.workspace_name}
                </li>
              ))}
            </ul>
          </section>
        )}

        {isNew ? (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold">Selamat datang</h1>
            <p className="mt-1 text-zinc-600">
              Kamu belum tergabung di workspace atau proyek mana pun.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/join" className={buttonClass("primary")}>
                Gabung dengan kode proyek
              </Link>
              <Link href="/onboarding" className={buttonClass("secondary")}>
                Buat workspace perusahaan
              </Link>
            </div>
            <p className="mt-4 text-sm text-zinc-600">
              Punya link undangan? Buka link itu langsung dari pesan Admin proyekmu.
            </p>
          </section>
        ) : (
          <>
            {workspaces.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Workspace kamu (Admin)</h2>
                  <Link href="/onboarding" className={buttonClass("ghost", "h-10 px-3 text-sm")}>
                    + Workspace baru
                  </Link>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {workspaces.map((w) => (
                    <li key={w.id}>
                      <Link
                        href={`/w/${w.slug}`}
                        className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400"
                      >
                        <span className="font-medium">{w.name}</span>
                        <span className="block font-mono text-sm text-zinc-500">/w/{w.slug}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {memberships.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold">Proyek yang kamu ikuti</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {memberships.map((m) => (
                    <li key={m.project.id}>
                      <Link
                        href={`/w/${m.project.workspace.slug}/p/${m.project.id}`}
                        className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400"
                      >
                        <span className="font-medium">{m.project.name}</span>
                        <span className="block text-sm text-zinc-500">
                          {m.project.workspace.name} · {ROLE_LABEL[m.role]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="text-sm text-zinc-600">
              Diberi kode proyek baru?{" "}
              <Link href="/join" className="font-medium text-zinc-900 underline">
                Gabung dengan kode
              </Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
