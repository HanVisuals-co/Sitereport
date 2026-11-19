import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClass } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { countMembers, getProject, getWorkspace, isUuid, TIMEZONE_LABEL } from "@/lib/data";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  );
}

export default async function ProjectPage(props: PageProps<"/w/[slug]/p/[projectId]">) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) notFound();

  const members = await countMembers(project.id);
  const pendingCount = members.pending;

  const settings: [string, string][] = [
    ["Kode", project.code ?? "—"],
    ["Lokasi", project.location ?? "—"],
    ["Zona waktu", TIMEZONE_LABEL[project.timezone] ?? project.timezone],
    ["Mulai", formatDate(project.start_date)],
    ["Selesai", formatDate(project.end_date)],
    [
      "Periode laporan",
      project.report_period_days === 1 ? "Harian" : `Setiap ${project.report_period_days} hari`,
    ],
    ["Batas lapor terlambat", `${project.backdate_limit_days} hari`],
    ["Jam pengingat", project.reminder_time.slice(0, 5)],
  ];

  return (
    <>
      <div>
        <Link href={`/w/${slug}`} className="text-sm text-zinc-600 hover:underline">
          ← Semua proyek
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.status === "archived" && (
            <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700">Arsip</span>
          )}
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Pengaturan</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {settings.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-zinc-600">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Tim</h2>
        <p className="text-zinc-700">
          {members.pengawas} Pengawas · {members.pelaksana} Pelaksana
        </p>
        {ws.isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/w/${slug}/p/${project.id}/members`}
              className={buttonClass("secondary")}
            >
              Kelola anggota
            </Link>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                {pendingCount} permintaan bergabung
              </span>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
        <h2 className="text-lg font-semibold">BOQ</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Import BOQ menyusul. Laporan harian baru bisa dibuat setelah BOQ terisi.
        </p>
      </section>
    </>
  );
}
