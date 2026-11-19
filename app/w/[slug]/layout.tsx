import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/session";
import { getWorkspace } from "@/lib/data";

// Membaca sesi di level atas, jadi route ini boleh blocking.
// Lihat docs Next: guides/authentication-with-cache-components.
export const instant = false;

export default async function WorkspaceLayout(props: LayoutProps<"/w/[slug]">) {
  const { slug } = await props.params;
  const user = await requireUser();
  const result = await getWorkspace(slug, user.id);
  if (!result) notFound();

  return (
    <>
      <AppHeader title={result.workspace.name} email={user.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
        {props.children}
      </main>
    </>
  );
}
