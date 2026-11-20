"use client";

import { useEffect } from "react";

/**
 * Safari iOS hanya menerapkan style :active (efek tombol ditekan) kalau halaman
 * punya listener touchstart. Listener kosong ini cukup untuk mengaktifkannya.
 */
export function TouchActive() {
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  return null;
}
