import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/session";

import { WorkspaceForm } from "./workspace-form";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export const metadata: Metadata = { title: "Buat workspace · SiteReport" };

export default async function OnboardingPage() {
  const user = await requireUser();

  return (
    <>
      <AppHeader title="SiteReport" email={user.email} />
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold">Buat workspace perusahaan</h1>
        <p className="mb-6 mt-1 text-zinc-600">
          Workspace menampung semua proyek perusahaanmu. Kamu otomatis menjadi Admin.
        </p>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <WorkspaceForm />
        </div>
      </main>
    </>
  );
}
