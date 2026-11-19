"use client";

import { useActionState, useEffect, useRef } from "react";

import { SmallSubmit } from "@/components/ui/confirm-submit";
import type { MasterKind } from "@/lib/master/data";

import { addMasterItem, type MasterFormState } from "./actions";

export function AddMasterForm({
  slug,
  projectId,
  kind,
  unitHint,
}: {
  slug: string;
  projectId: string;
  kind: MasterKind;
  unitHint: string;
}) {
  const [state, action] = useActionState<MasterFormState, FormData>(
    addMasterItem.bind(null, slug, projectId, kind),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>("input[name=name]")?.focus();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="name"
          required
          placeholder="Nama"
          aria-label="Nama"
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 text-sm"
        />
        <input
          name="unit"
          placeholder={unitHint}
          aria-label="Satuan"
          className="h-10 w-28 rounded-lg border border-zinc-300 px-3 text-sm"
        />
        <SmallSubmit variant="primary">Tambah</SmallSubmit>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
