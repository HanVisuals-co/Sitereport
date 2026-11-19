"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

import { startReport, type StartState } from "./actions";

export function StartReportForm({
  slug,
  projectId,
  today,
  minDate,
}: {
  slug: string;
  projectId: string;
  today: string;
  minDate: string;
}) {
  const [state, action, pending] = useActionState<StartState, FormData>(
    startReport.bind(null, slug, projectId),
    {},
  );
  const [showOther, setShowOther] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="date" value={today} />
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Membuka…" : "Isi laporan hari ini"}
        </Button>
      </form>

      {showOther ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Tanggal laporan
            <input
              type="date"
              name="date"
              min={minDate}
              max={today}
              defaultValue={today}
              required
              className="h-12 rounded-lg border border-zinc-300 bg-white px-3"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Buka
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowOther(true)}
          className="self-start text-sm font-medium text-zinc-700 underline"
        >
          Lapor untuk tanggal lain (terlambat)
        </button>
      )}
      <FormError message={state.error} />
    </div>
  );
}
