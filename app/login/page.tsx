import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth/session";

import { LoginForm } from "./login-form";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export const metadata: Metadata = { title: "Masuk · SiteReport" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getUser()) redirect("/");

  const { error } = await props.searchParams;
  const initialError =
    error === "auth" ? "Link masuk tidak valid atau sudah kedaluwarsa. Minta link baru." : undefined;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Masuk ke SiteReport</h1>
        <p className="mb-6 mt-1 text-zinc-600">Laporan harian proyek, dicek Pengawas.</p>
        <LoginForm initialError={initialError} />
      </div>
    </main>
  );
}
