"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, workspaceSchema, type FieldErrors } from "@/lib/validation";

export type WorkspaceFormState = {
  errors?: FieldErrors;
  values?: { name: string; slug: string };
};

export async function createWorkspace(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const values = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  };

  const parsed = workspaceSchema.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .insert({ ...parsed.data, created_by: user.id });

  if (error) {
    if (error.code === "23505") {
      return { errors: { slug: "Alamat ini sudah dipakai. Pilih yang lain." }, values };
    }
    return { errors: { _form: "Gagal membuat workspace. Coba lagi." }, values };
  }

  redirect(`/w/${parsed.data.slug}`);
}
