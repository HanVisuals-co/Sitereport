import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getWorkspace } from "@/lib/data";

import { ProjectForm } from "./project-form";

// Halaman ini membaca sesi, jadi navigasinya boleh menunggu server.
export const instant = false;

export const metadata: Metadata = { title: "Proyek baru · SiteReport" };

export default async function NewProjectPage(props: PageProps<"/w/[slug]/projects/new">) {
  const { slug } = await props.params;
  const user = await requireUser();
  const result = await getWorkspace(slug, user.id);
  if (!result?.isAdmin) notFound();

  return (
    <>
      <div>
        <Link href={`/w/${slug}`} className="text-sm text-zinc-600 hover:underline">
          ← Kembali ke daftar proyek
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Proyek baru</h1>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <ProjectForm slug={slug} />
      </div>
    </>
  );
}
