"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";

import { sendMagicLink, type MagicLinkState } from "./actions";

// Tampilkan tombol Google hanya kalau provider Google sudah diaktifkan di Supabase.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

export function LoginForm({ initialError, next }: { initialError?: string; next: string }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, {
    status: "idle",
  });
  const [googleError, setGoogleError] = useState<string>();
  const [googlePending, setGooglePending] = useState(false);

  async function signInWithGoogle() {
    setGoogleError(undefined);
    setGooglePending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setGooglePending(false);
      setGoogleError("Masuk dengan Google belum tersedia. Gunakan email.");
    }
  }

  if (state.status === "sent") {
    return (
      <div className="flex flex-col gap-3" role="status">
        <h2 className="text-lg font-semibold">Cek email kamu</h2>
        <p className="text-zinc-700">
          Link masuk sudah dikirim ke <span className="font-medium">{state.email}</span>. Buka
          link itu dari HP atau browser yang sama.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FormError message={initialError ?? googleError} />

      {GOOGLE_ENABLED && (
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={signInWithGoogle}
            disabled={googlePending}
          >
            {googlePending ? "Mengalihkan..." : "Masuk dengan Google"}
          </Button>

          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="h-px flex-1 bg-zinc-300" />
            atau
            <span className="h-px flex-1 bg-zinc-300" />
          </div>
        </>
      )}

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.status === "error" ? state.email : undefined}
          error={state.status === "error" ? state.message : undefined}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Mengirim..." : "Kirim link masuk"}
        </Button>
      </form>
    </div>
  );
}
