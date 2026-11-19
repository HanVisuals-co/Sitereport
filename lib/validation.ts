import { z } from "zod";

import { SLUG_PATTERN } from "@/lib/slug";

export const TIMEZONES = [
  { value: "Asia/Jakarta", label: "WIB (Asia/Jakarta)" },
  { value: "Asia/Makassar", label: "WITA (Asia/Makassar)" },
  { value: "Asia/Jayapura", label: "WIT (Asia/Jayapura)" },
] as const;

export const workspaceSchema = z.object({
  name: z.string().trim().min(1, "Nama perusahaan wajib diisi.").max(120, "Maksimal 120 karakter."),
  slug: z
    .string()
    .trim()
    .regex(SLUG_PATTERN, "Gunakan 3–60 huruf kecil, angka, atau tanda hubung (-)."),
});

const optionalText = z
  .string()
  .trim()
  .max(200, "Maksimal 200 karakter.")
  .transform((v) => (v === "" ? null : v));

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tanggal tidak valid.")
  .transform((v) => (v === "" ? null : v));

export const projectSchema = z
  .object({
    name: z.string().trim().min(1, "Nama proyek wajib diisi.").max(200, "Maksimal 200 karakter."),
    code: optionalText,
    location: optionalText,
    timezone: z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"], {
      message: "Pilih zona waktu.",
    }),
    start_date: optionalDate,
    end_date: optionalDate,
    report_period_days: z.coerce
      .number({ message: "Isi angka." })
      .int("Isi bilangan bulat.")
      .min(1, "Minimal 1 hari.")
      .max(31, "Maksimal 31 hari."),
    backdate_limit_days: z.coerce
      .number({ message: "Isi angka." })
      .int("Isi bilangan bulat.")
      .min(0, "Minimal 0 hari.")
      .max(60, "Maksimal 60 hari."),
    reminder_time: z.string().regex(/^\d{2}:\d{2}$/, "Jam tidak valid."),
  })
  .refine((p) => !p.start_date || !p.end_date || p.end_date >= p.start_date, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
    path: ["end_date"],
  });

export type FieldErrors = Record<string, string>;

/** Ambil pesan error pertama per field dari hasil zod. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    out[key] ??= issue.message;
  }
  return out;
}
