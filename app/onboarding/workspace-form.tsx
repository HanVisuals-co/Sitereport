"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { slugify } from "@/lib/slug";

import { createWorkspace, type WorkspaceFormState } from "./actions";

export function WorkspaceForm() {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    createWorkspace,
    {},
  );
  const [name, setName] = useState(state.values?.name ?? "");
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError message={state.errors?._form} />
      <TextField
        label="Nama perusahaan"
        name="name"
        placeholder="PT Karya Beton Nusantara"
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        error={state.errors?.name}
      />
      <TextField
        label="Alamat workspace"
        name="slug"
        required
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        error={state.errors?.slug}
        hint={
          <>
            Dipakai di URL: <span className="font-mono">/w/{slug || "nama-perusahaan"}</span>
          </>
        }
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Membuat..." : "Buat workspace"}
      </Button>
    </form>
  );
}
