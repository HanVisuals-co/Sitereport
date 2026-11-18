function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Environment variable ${name} belum diisi. Lihat .env.example.`);
  }
  return value;
}

/** Variabel publik (aman dikirim ke browser). */
export const env = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};
