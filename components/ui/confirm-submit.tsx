"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass } from "@/components/ui/button";

/** Tombol submit yang meminta konfirmasi dulu. Dipakai di dalam <form action={...}>. */
export function ConfirmSubmit({
  message,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass("ghost", `h-10 px-3 text-sm text-red-700 hover:bg-red-50 ${className}`)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    >
      {pending ? "..." : children}
    </button>
  );
}

/** Tombol submit kecil dengan status pending. */
export function SmallSubmit({
  children,
  variant = "secondary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, "h-10 px-3 text-sm")}>
      {pending ? "..." : children}
    </button>
  );
}
