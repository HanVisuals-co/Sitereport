"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { SECTION_LABEL } from "@/lib/reports/types";

import {
  approveReport,
  reopenReport,
  requestRevision,
  resolveDuplicate,
  type ReviewResult,
} from "../actions";

type Ids = { slug: string; projectId: string; reportId: string };

const textarea =
  "w-full rounded-lg border border-zinc-300 bg-white p-3 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20";

/** Menjalankan aksi review dan menyimpan pesan error-nya. */
function useReviewAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ReviewResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.message);
    });
  return { pending, error, run };
}

/** Tombol keputusan Pengawas untuk satu flag duplikat (volume atau foto). */
export function DupDecision({
  ids,
  kind,
  refId,
  resolution,
}: {
  ids: Ids;
  kind: "volume" | "photo";
  refId: string;
  resolution: "valid" | "duplicate" | null;
}) {
  const { pending, error, run } = useReviewAction();
  const pick = (r: "valid" | "duplicate") =>
    run(() => resolveDuplicate(ids.slug, ids.projectId, ids.reportId, kind, refId, r));
  const cls = (active: boolean) =>
    `h-9 rounded-md border px-2.5 text-xs font-medium transition active:scale-[0.97] disabled:opacity-60 ${
      active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100"
    }`;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Keputusan duplikat">
        <button type="button" disabled={pending} aria-pressed={resolution === "valid"} className={cls(resolution === "valid")} onClick={() => pick("valid")}>
          Valid, jumlahkan
        </button>
        <button type="button" disabled={pending} aria-pressed={resolution === "duplicate"} className={cls(resolution === "duplicate")} onClick={() => pick("duplicate")}>
          Duplikat
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Panel Pengawas: Approve atau Minta revisi, dengan catatan umum dan komentar per bagian. */
export function ReviewPanel({
  ids,
  unresolved,
  hasDuplicate,
}: {
  ids: Ids;
  unresolved: number;
  hasDuplicate: boolean;
}) {
  const { pending, error, run } = useReviewAction();
  const [note, setNote] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});

  const approveBlocked = unresolved > 0 || hasDuplicate;
  const commentList = Object.entries(comments)
    .map(([section, comment]) => ({ section, comment: comment.trim() }))
    .filter((c) => c.comment);

  return (
    <section className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-semibold">Review</h2>
      <label htmlFor="review-note" className="text-sm font-medium">
        Catatan
      </label>
      <textarea
        id="review-note"
        rows={3}
        maxLength={5000}
        className={`${textarea} mt-1.5`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-800">Komentar per bagian (opsional)</summary>
        <div className="mt-2 flex flex-col gap-2">
          {Object.entries(SECTION_LABEL).map(([section, label]) => (
            <div key={section}>
              <label htmlFor={`c-${section}`} className="text-sm text-zinc-700">
                {label}
              </label>
              <textarea
                id={`c-${section}`}
                rows={1}
                maxLength={2000}
                className={`${textarea} mt-1`}
                value={comments[section] ?? ""}
                onChange={(e) => setComments({ ...comments, [section]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </details>

      {unresolved > 0 && (
        <p className="mt-3 text-sm text-amber-900">Putuskan {unresolved} flag duplikat dulu sebelum menyetujui.</p>
      )}
      {unresolved === 0 && hasDuplicate && (
        <p className="mt-3 text-sm text-amber-900">Ada data yang diputuskan duplikat. Minta revisi ke Pelaksana.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={pending || approveBlocked}
          onClick={() => {
            if (!window.confirm("Setujui laporan ini? Laporan akan terkunci.")) return;
            run(() => approveReport(ids.slug, ids.projectId, ids.reportId, note));
          }}
        >
          {pending ? "..." : "Setujui"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || (!note.trim() && commentList.length === 0)}
          onClick={() => run(() => requestRevision(ids.slug, ids.projectId, ids.reportId, note, commentList))}
        >
          Minta revisi
        </Button>
      </div>
      {!note.trim() && commentList.length === 0 && (
        <p className="mt-2 text-xs text-zinc-600">Minta revisi butuh catatan atau komentar.</p>
      )}
    </section>
  );
}

/** Admin membuka ulang laporan yang sudah disetujui. */
export function ReopenPanel({ ids }: { ids: Ids }) {
  const { pending, error, run } = useReviewAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Buka ulang laporan
      </Button>
    );
  }
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-lg font-semibold">Buka ulang laporan</h2>
      <label htmlFor="reopen-note" className="text-sm font-medium">
        Alasan (tercatat di audit log)
      </label>
      <textarea
        id="reopen-note"
        rows={3}
        maxLength={5000}
        className={`${textarea} mt-1.5`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          disabled={pending || !note.trim()}
          onClick={() => run(() => reopenReport(ids.slug, ids.projectId, ids.reportId, note))}
        >
          {pending ? "..." : "Buka ulang"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </section>
  );
}
