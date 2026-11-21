import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/ui/back-link";
import { requireUser } from "@/lib/auth/session";
import { getProject, getWorkspace, isUuid } from "@/lib/data";
import { listMasterItems } from "@/lib/master/data";
import { getMyRole, getReport, listBoqLeaves } from "@/lib/reports/data";
import { formatPeriod, STATUS_CLASS, STATUS_LABEL } from "@/lib/reports/types";

import { ReportForm } from "./report-form";
import { ReportView } from "./report-view";
import { ReopenPanel, ReviewPanel } from "./review-panel";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export const metadata: Metadata = { title: "Laporan harian · SiteReport" };

export default async function ReportPage(
  props: PageProps<"/w/[slug]/p/[projectId]/reports/[reportId]">,
) {
  const { slug, projectId, reportId } = await props.params;
  if (!isUuid(projectId) || !isUuid(reportId)) notFound();

  const user = await requireUser();
  const [ws, project, report] = await Promise.all([
    getWorkspace(slug, user.id),
    getProject(projectId),
    getReport(reportId),
  ]);
  if (!ws || !project || project.workspace_id !== ws.workspace.id) notFound();
  if (!report || report.project_id !== project.id) notFound();

  const [role, masterItems, leaves] = await Promise.all([
    getMyRole(project.id, user.id),
    listMasterItems(project.id),
    listBoqLeaves(project.id),
  ]);

  const canEdit =
    report.author_id === user.id &&
    role === "pelaksana" &&
    (report.status === "draft" || report.status === "revision_requested");

  const canReview =
    role === "pengawas" && report.author_id !== user.id && report.status === "submitted";
  const canReopen = ws.isAdmin && report.status === "approved";
  const ids = { slug, projectId: project.id, reportId: report.id };
  const flagged = [...report.volumes, ...report.photos].filter((x) => x.dup_flag);

  // Daftar master: form hanya menampilkan yang aktif, tampilan baca menampilkan semua (data lama).
  const pick = (kind: "labor" | "equipment" | "material", activeOnly: boolean) =>
    masterItems
      .filter((m) => m.kind === kind && (!activeOnly || m.active))
      .map((m) => ({ id: m.id, name: m.name, unit: m.unit }));
  const masters = (activeOnly: boolean) => ({
    labor: pick("labor", activeOnly),
    equipment: pick("equipment", activeOnly),
    material: pick("material", activeOnly),
  });

  const lastRevision =
    report.status === "revision_requested"
      ? report.reviews.find((r) => r.action === "request_revision" || r.action === "reopen") ?? null
      : null;

  return (
    <>
      <div>
        <BackLink href={`/w/${slug}/p/${project.id}/reports`}>Laporan {project.name}</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{formatPeriod(report.period_start, report.period_end)}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[report.status]}`}>
            {STATUS_LABEL[report.status]}
          </span>
          {report.is_late && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
              Terlambat
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-600">{report.author?.full_name || report.author?.email}</p>
      </div>

      {canEdit ? (
        <ReportForm
          slug={slug}
          projectId={project.id}
          reportId={report.id}
          basePath={`${ws.workspace.id}/${project.id}/${report.id}`}
          updatedAt={report.updated_at}
          initial={{
            notes_raw: report.notes_raw ?? "",
            weather: report.weather,
            labor: report.labor,
            equipment: report.equipment,
            materials: report.materials,
            volumes: report.volumes.map((v) => ({ boq_item_id: v.boq_item_id, volume: v.volume })),
          }}
          photos={report.photos}
          masters={masters(true)}
          leaves={leaves}
          revision={
            lastRevision ? { note: lastRevision.note, comments: lastRevision.comments } : null
          }
        />
      ) : (
        <>
          <ReportView
            report={report}
            masters={masters(false)}
            leaves={leaves}
            reviewIds={canReview ? ids : undefined}
          />
          {canReview && (
            <ReviewPanel
              ids={ids}
              unresolved={flagged.filter((x) => x.dup_resolution === null).length}
              hasDuplicate={flagged.some((x) => x.dup_resolution === "duplicate")}
            />
          )}
          {canReopen && <ReopenPanel ids={ids} />}
        </>
      )}
    </>
  );
}
