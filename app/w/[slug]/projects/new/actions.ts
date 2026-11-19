"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, projectSchema, type FieldErrors } from "@/lib/validation";

export type ProjectFormState = {
  errors?: FieldErrors;
  values?: Record<string, string>;
};

const FIELDS = [
  "name",
  "code",
  "location",
  "timezone",
  "start_date",
  "end_date",
  "report_period_days",
  "backdate_limit_days",
  "reminder_time",
] as const;

export async function createProject(
  slug: string,
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    FIELDS.map((f) => [f, String(formData.get(f) ?? "")]),
  ) as Record<(typeof FIELDS)[number], string>;

  const parsed = projectSchema.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const ws = await getWorkspace(slug, user.id);
  if (!ws?.isAdmin) {
    return { errors: { _form: "Hanya Admin workspace yang bisa membuat proyek." }, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...parsed.data, workspace_id: ws.workspace.id })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return { errors: { _form: "Gagal membuat proyek. Coba lagi." }, values };
  }

  redirect(`/w/${slug}/p/${data.id}`);
}
