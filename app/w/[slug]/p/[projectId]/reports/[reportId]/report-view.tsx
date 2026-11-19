import { formatNumber } from "@/lib/format";
import type { QuickMaster } from "../actions";
import type { ReportDetail } from "@/lib/reports/data";
import {
  SECTION_LABEL,
  WEATHER_CONDS,
  WEATHER_SLOTS,
  type BoqLeaf,
} from "@/lib/reports/types";

const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const ACTION_LABEL = {
  approve: "Disetujui",
  request_revision: "Minta revisi",
  reopen: "Dibuka ulang Admin",
} as const;

/** Tampilan laporan read-only (untuk Pengawas, Admin, atau laporan yang sudah dikirim). */
export function ReportView({
  report,
  masters,
  leaves,
}: {
  report: ReportDetail;
  masters: Record<"labor" | "equipment" | "material", QuickMaster[]>;
  leaves: BoqLeaf[];
}) {
  const nameOf = (kind: keyof typeof masters, id: string) =>
    masters[kind].find((m) => m.id === id) ?? { name: "(dihapus)", unit: null };
  const leafById = new Map(leaves.map((l) => [l.id, l]));
  const condLabel = Object.fromEntries(WEATHER_CONDS.map((c) => [c.cond, c.label]));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Cuaca">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {WEATHER_SLOTS.map(({ slot, label }) => {
            const w = report.weather.find((x) => x.slot === slot);
            return (
              <div key={slot}>
                <dt className="text-zinc-600">{label}</dt>
                <dd className="font-medium">
                  {w ? condLabel[w.condition] : "—"}
                  {w?.condition === "hujan" && w.rain_hours > 0 && ` (${formatNumber(w.rain_hours)} jam)`}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Tenaga kerja">
          {report.labor.length === 0 ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <ul className="text-sm">
              {report.labor.map((l) => (
                <li key={l.master_item_id} className="flex justify-between py-0.5">
                  <span>{nameOf("labor", l.master_item_id).name}</span>
                  <span className="font-medium tabular-nums">{l.count}</span>
                </li>
              ))}
              <li className="mt-1 flex justify-between border-t border-zinc-100 pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{report.labor.reduce((s, l) => s + l.count, 0)}</span>
              </li>
            </ul>
          )}
        </Card>
        <Card title="Alat">
          {report.equipment.length === 0 ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <ul className="text-sm">
              {report.equipment.map((e) => (
                <li key={e.master_item_id} className="flex justify-between py-0.5">
                  <span>{nameOf("equipment", e.master_item_id).name}</span>
                  <span className="tabular-nums">
                    <span className="font-medium">{e.count}</span>
                    {e.hours > 0 && <span className="text-zinc-600"> · {formatNumber(e.hours)} jam</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Material masuk">
        {report.materials.length === 0 ? (
          <p className="text-sm text-zinc-600">—</p>
        ) : (
          <ul className="text-sm">
            {report.materials.map((m) => {
              const master = nameOf("material", m.master_item_id);
              return (
                <li key={m.master_item_id} className="flex justify-between py-0.5">
                  <span>{master.name}</span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(m.quantity)} {master.unit ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Volume pekerjaan">
        {report.volumes.length === 0 ? (
          <p className="text-sm text-zinc-600">Tidak ada volume pekerjaan.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
            {report.volumes.map((v) => {
              const leaf = leafById.get(v.boq_item_id);
              return (
                <li key={v.boq_item_id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    {leaf?.path && <p className="text-xs text-zinc-500">{leaf.path}</p>}
                    <p>{leaf?.name ?? "(item dihapus)"}</p>
                    {v.dup_flag && (
                      <p className="mt-0.5 text-xs font-medium text-amber-800">
                        Mirip laporan lain
                        {v.dup_resolution === "valid" && " · dinyatakan valid"}
                        {v.dup_resolution === "duplicate" && " · dinyatakan duplikat"}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatNumber(v.volume)} {leaf?.unit ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Kendala / catatan">
        <p className="whitespace-pre-wrap text-sm">{report.notes_polished || report.notes_raw || "—"}</p>
      </Card>

      <Card title={`Foto (${report.photos.length})`}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {report.photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border border-zinc-200">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed URL privat */}
                  <img src={p.url} alt="Foto lapangan" className="aspect-square w-full object-cover" />
                </a>
              ) : (
                <div className="aspect-square bg-zinc-100" />
              )}
              <div className="absolute left-1 top-1 flex flex-col gap-1">
                {p.source === "gallery" && (
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white">
                    Dari galeri
                  </span>
                )}
                {p.dup_flag && (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                    Foto sama di laporan lain
                  </span>
                )}
              </div>
              <p className="bg-white px-1.5 py-1 text-xs text-zinc-600">
                {p.taken_at ? dateTime.format(new Date(p.taken_at)) : "Waktu tidak diketahui"}
                {p.lat !== null && p.lng !== null && (
                  <>
                    {" · "}
                    <a
                      className="underline"
                      href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      lokasi
                    </a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {report.reviews.length > 0 && (
        <Card title="Riwayat review">
          <ul className="flex flex-col gap-3 text-sm">
            {report.reviews.map((r) => (
              <li key={r.id}>
                <p>
                  <span className="font-medium">{ACTION_LABEL[r.action]}</span>
                  <span className="text-zinc-600">
                    {" "}
                    · {r.reviewer?.full_name || r.reviewer?.email} · {dateTime.format(new Date(r.created_at))}
                  </span>
                </p>
                {r.note && <p className="text-zinc-800">{r.note}</p>}
                {r.comments.length > 0 && (
                  <ul className="list-disc pl-5 text-zinc-700">
                    {r.comments.map((c, i) => (
                      <li key={i}>
                        {SECTION_LABEL[c.section] ?? c.section}: {c.comment}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
