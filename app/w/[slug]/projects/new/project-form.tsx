"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormError, SelectField, TextField } from "@/components/ui/field";
import { TIMEZONES } from "@/lib/validation";

import { createProject, type ProjectFormState } from "./actions";

export function ProjectForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(
    createProject.bind(null, slug),
    {},
  );
  const v = state.values ?? {};
  const e = state.errors ?? {};

  return (
    <form action={action} className="flex flex-col gap-6">
      <FormError message={e._form} />

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">Data proyek</legend>
        <TextField
          label="Nama proyek"
          name="name"
          required
          placeholder="Pembangunan Gedung Kantor Dinas"
          defaultValue={v.name}
          error={e.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Kode proyek (opsional)" name="code" defaultValue={v.code} error={e.code} />
          <TextField
            label="Lokasi (opsional)"
            name="location"
            placeholder="Kab. Sleman, DIY"
            defaultValue={v.location}
            error={e.location}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Tanggal mulai (opsional)"
            name="start_date"
            type="date"
            defaultValue={v.start_date}
            error={e.start_date}
          />
          <TextField
            label="Tanggal selesai (opsional)"
            name="end_date"
            type="date"
            defaultValue={v.end_date}
            error={e.end_date}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">Aturan laporan</legend>
        <SelectField
          label="Zona waktu proyek"
          name="timezone"
          options={[...TIMEZONES]}
          defaultValue={v.timezone ?? "Asia/Jakarta"}
          error={e.timezone}
          hint="Tanggal laporan mengikuti zona waktu ini."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Periode laporan (hari)"
            name="report_period_days"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            defaultValue={v.report_period_days ?? "1"}
            error={e.report_period_days}
            hint="1 = laporan harian."
          />
          <TextField
            label="Batas lapor terlambat (hari)"
            name="backdate_limit_days"
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            required
            defaultValue={v.backdate_limit_days ?? "2"}
            error={e.backdate_limit_days}
            hint="Lewat batas ini, perlu dibuka Admin."
          />
          <TextField
            label="Jam pengingat"
            name="reminder_time"
            type="time"
            required
            defaultValue={v.reminder_time ?? "17:00"}
            error={e.reminder_time}
            hint="Untuk Pelaksana yang belum lapor."
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending} className="sm:self-start">
        {pending ? "Menyimpan..." : "Buat proyek"}
      </Button>
    </form>
  );
}
