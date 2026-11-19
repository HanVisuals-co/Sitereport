import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { countBoqItems } from "@/lib/boq/data";
import { getProject, getWorkspace, isUuid } from "@/lib/data";
import { getMyRole, listReports, todayIn } from "@/lib/reports/data";
import { formatPeriod, STATUS_CLASS, STATUS_LABEL } from "@/lib/reports/types";

import { StartReportForm } from "./start-report-form";

export const metadata: Metadata = { title: "Laporan · SiteReport" };

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function ReportsPage(props: PageProps<"/w/[slug]/p/[projectId]/reports">) {
  const { slug, projectId } = await props.params;
  if (!isUuid(projectId)) notFound();

  const user = await requireUser();
  const [ws, project] = await Promise.all([getWorkspace(slug, user.id), getProject(projectId)]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) notFound();

  const [role, boqCount] = await Promise.all([
    getMyRole(project.id, user.id),
    countBoqItems(project.id),
  ]);
  const isPelaksana = role === "pelaksana";
  const reports = await listReports(project.id, isPelaksana ? { authorId: user.id } : {});
  const today = todayIn(project.timezone);
  const minDate = addDays(today, -(project.backdate_limit_days + project.report_period_days - 1));

  const needsAction = reports.filter((r) => r.status === "draft" || r.status === "revision_requested");

  return (
    <>
      <div>
        <Link href={`/w/${slug}/p/${project.id}`} className="text-sm text-zinc-600 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {isPelaksana ? "Laporan saya" : "Laporan masuk"}
        </h1>
      </div>

      {isPelaksana && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          {boqCount === 0 ? (
            <p className="text-zinc-700">
              BOQ proyek belum diisi Admin. Laporan baru bisa dibuat setelah BOQ ada.
            </p>
          ) : (
            <StartReportForm slug={slug} projectId={project.id} today={today} minDate={minDate} />
          )}
        </section>
      )}

      {isPelaksana && needsAction.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold">Perlu dilanjutkan</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {needsAction.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/w/${slug}/p/${project.id}/reports/${r.id}`}
                  className="font-medium underline"
                >
                  {formatPeriod(r.period_start, r.period_end)}
                </Link>{" "}
                <span className="text-sm">· {STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        {reports.length === 0 ? (
          <p className="p-6 text-center text-zinc-600">Belum ada laporan.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/w/${slug}/p/${project.id}/reports/${r.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{formatPeriod(r.period_start, r.period_end)}</p>
                    {!isPelaksana && (
                      <p className="truncate text-sm text-zinc-600">
                        {r.author?.full_name || r.author?.email}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.is_late && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        Terlambat
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
