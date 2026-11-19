"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError, SelectField } from "@/components/ui/field";

import { createInvite, type InviteState } from "./actions";

const ROLE_OPTIONS = [
  { value: "pelaksana", label: "Pelaksana (pengisi laporan)" },
  { value: "pengawas", label: "Pengawas (pemeriksa laporan)" },
];

export function InvitePanel({ slug, projectId }: { slug: string; projectId: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    createInvite.bind(null, slug, projectId),
    { status: "idle" },
  );
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <SelectField label="Peran" name="role" options={ROLE_OPTIONS} defaultValue="pelaksana" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Membuat..." : "Buat link undangan"}
        </Button>
      </form>

      {state.status === "error" && <FormError message={state.message} />}

      {state.status === "created" && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-900">
            Link undangan {state.role === "pengawas" ? "Pengawas" : "Pelaksana"} berlaku 7 hari.
            Salin sekarang: link ini tidak bisa ditampilkan lagi.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={state.link}
              aria-label="Link undangan"
              onFocus={(e) => e.currentTarget.select()}
              className="h-12 flex-1 rounded-lg border border-emerald-300 bg-white px-3 font-mono text-sm"
            />
            <Button type="button" variant="secondary" onClick={() => copy(state.link)}>
              {copied ? "Tersalin" : "Salin"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
