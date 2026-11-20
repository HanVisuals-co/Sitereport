import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { ConfirmSubmit, SmallSubmit } from "@/components/ui/confirm-submit";
import { requireUser } from "@/lib/auth/session";
import {
  getProject,
  getWorkspace,
  isUuid,
  listActiveInvites,
  listProjectMembers,
  ROLE_LABEL,
  type ProjectMember,
  type ProjectRole,
} from "@/lib/data";

import {
  approveRequest,
  changeRole,
  regenerateCode,
  rejectRequest,
  removeMember,
  revokeInvite,
} from "./actions";
import { InvitePanel } from "./invite-panel";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export const metadata: Metadata = { title: "Anggota proyek · SiteReport" };

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

function displayName(m: ProjectMember) {
  return m.profile?.full_name || m.profile?.email || "Tanpa nama";
}

function RoleSelect({ defaultValue }: { defaultValue: ProjectRole }) {
  return (
    <select
      name="role"
      defaultValue={defaultValue === "viewer" ? "pelaksana" : defaultValue}
      aria-label="Peran"
      className="h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm"
    >
      <option value="pelaksana">Pelaksana</option>
      <option value="pengawas">Pengawas</option>
    </select>
  );
}

export default async function MembersPage(props: PageProps<"/w/[slug]/p/[projectId]/members">) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws?.isAdmin || !project || project.workspace_id !== ws.workspace.id) notFound();

  const [members, invites] = await Promise.all([
    listProjectMembers(project.id),
    listActiveInvites(project.id),
  ]);
  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  return (
    <>
      <div>
        <BackLink href={`/w/${slug}/p/${project.id}`}>{project.name}</BackLink>
        <h1 className="mt-2 text-2xl font-semibold">Anggota proyek</h1>
      </div>

      {pending.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold">Permintaan bergabung ({pending.length})</h2>
          <p className="mb-4 text-sm text-zinc-700">
            Masuk lewat kode proyek. Pilih perannya sebelum menyetujui.
          </p>
          <ul className="flex flex-col divide-y divide-amber-200">
            {pending.map((m) => (
              <li key={m.user_id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">{displayName(m)}</p>
                  <p className="text-sm text-zinc-600">
                    {m.profile?.email} · {dateFmt.format(new Date(m.created_at))}
                  </p>
                </div>
                <form
                  action={approveRequest.bind(null, slug, project.id, m.user_id)}
                  className="flex items-center gap-2"
                >
                  <RoleSelect defaultValue="pelaksana" />
                  <SmallSubmit variant="primary">Setujui</SmallSubmit>
                </form>
                <form action={rejectRequest.bind(null, slug, project.id, m.user_id)}>
                  <ConfirmSubmit message={`Tolak permintaan dari ${displayName(m)}?`}>
                    Tolak
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Undang lewat link</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Orang yang membuka link langsung bergabung dengan peran yang dipilih.
        </p>
        <InvitePanel slug={slug} projectId={project.id} />

        {invites.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 font-medium">Link aktif</h3>
            <ul className="flex flex-col divide-y divide-zinc-200">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium">{ROLE_LABEL[inv.role]}</span>
                    <span className="text-zinc-600">
                      {" "}
                      · berlaku sampai {dateFmt.format(new Date(inv.expires_at))} · dipakai{" "}
                      {inv.used_count}
                      {inv.max_uses ? `/${inv.max_uses}` : ""} kali
                    </span>
                  </div>
                  <form action={revokeInvite.bind(null, slug, project.id, inv.id)}>
                    <ConfirmSubmit message="Cabut link undangan ini? Link tidak bisa dipakai lagi.">
                      Cabut
                    </ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Kode proyek</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Bagikan kode ini ke tim lapangan. Mereka bergabung lewat menu “Gabung dengan kode”, lalu
          menunggu persetujuanmu.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 font-mono text-2xl font-semibold tracking-widest">
            {project.join_code}
          </span>
          <form action={regenerateCode.bind(null, slug, project.id)}>
            <ConfirmSubmit
              message="Ganti kode proyek? Kode lama langsung tidak berlaku."
              className="text-zinc-700 hover:bg-zinc-100"
            >
              Ganti kode
            </ConfirmSubmit>
          </form>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Anggota aktif ({active.length})</h2>
        {active.length === 0 ? (
          <p className="text-zinc-600">Belum ada anggota. Undang Pengawas dan Pelaksana di atas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200">
            {active.map((m) => (
              <li key={m.user_id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">
                    {displayName(m)}
                    {m.user_id === user.id && <span className="text-zinc-500"> (kamu)</span>}
                  </p>
                  <p className="text-sm text-zinc-600">{m.profile?.email}</p>
                </div>
                <form
                  action={changeRole.bind(null, slug, project.id, m.user_id)}
                  className="flex items-center gap-2"
                >
                  <RoleSelect defaultValue={m.role} />
                  <SmallSubmit>Simpan</SmallSubmit>
                </form>
                <form action={removeMember.bind(null, slug, project.id, m.user_id)}>
                  <ConfirmSubmit message={`Keluarkan ${displayName(m)} dari proyek?`}>
                    Keluarkan
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
