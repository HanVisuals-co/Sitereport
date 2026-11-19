import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/session";

import { JoinCodeForm } from "./join-code-form";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export const metadata: Metadata = { title: "Gabung dengan kode · SiteReport" };

export default async function JoinByCodePage() {
  const user = await requireUser();

  return (
    <>
      <AppHeader title="SiteReport" email={user.email} />
      <main className="mx-auto w-full max-w-sm px-4 py-10">
        <h1 className="text-2xl font-semibold">Gabung dengan kode proyek</h1>
        <p className="mb-6 mt-1 text-zinc-600">
          Minta kode 8 karakter ke Admin proyek. Admin perlu menyetujui sebelum kamu bisa mengisi
          laporan.
        </p>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <JoinCodeForm />
        </div>
      </main>
    </>
  );
}
