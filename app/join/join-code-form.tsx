"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button, buttonClass } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

import { joinByCode, type JoinCodeState } from "./actions";

export function JoinCodeForm() {
  const [state, action, pending] = useActionState<JoinCodeState, FormData>(joinByCode, {
    status: "idle",
  });

  if (state.status === "pending") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Permintaan terkirim</h2>
        <p className="text-zinc-700">
          Kamu meminta bergabung ke <span className="font-medium">{state.projectName}</span> (
          {state.workspaceName}). Tunggu Admin menyetujui. Proyek akan muncul di beranda setelah
          disetujui.
        </p>
        <Link href="/" className={buttonClass("secondary")}>
          Ke beranda
        </Link>
      </div>
    );
  }

  if (state.status === "active") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Kamu sudah anggota</h2>
        <p className="text-zinc-700">
          Kamu sudah tergabung di <span className="font-medium">{state.projectName}</span>.
        </p>
        <Link href="/" className={buttonClass("primary")}>
          Ke beranda
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Kode proyek"
        name="code"
        required
        autoComplete="off"
        autoCapitalize="characters"
        maxLength={8}
        placeholder="A1B2C3D4"
        className="h-14 w-full rounded-lg border border-zinc-300 bg-white px-3 text-center font-mono text-2xl uppercase tracking-widest outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20"
        defaultValue={state.status === "error" ? state.code : undefined}
        error={state.status === "error" ? state.message : undefined}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Mengirim..." : "Minta bergabung"}
      </Button>
    </form>
  );
}
