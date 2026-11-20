import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 active:bg-zinc-600 disabled:bg-zinc-400",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:text-zinc-400",
  ghost: "text-zinc-700 hover:bg-zinc-200 active:bg-zinc-300 disabled:text-zinc-400",
};

// active:scale memberi rasa "tertekan" di layar sentuh, tempat hover tidak ada.
export function buttonClass(variant: Variant = "primary", extra = "") {
  return `inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-base font-medium transition select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
