import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
};

// min-h-12 throughout: this is used one-handed, outdoors, in the dark.
export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5",
        "text-base font-semibold transition active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-orange-500 text-zinc-950 hover:bg-orange-400",
        variant === "ghost" && "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4",
        // 16px minimum, or iOS Safari zooms the viewport on focus.
        "text-base text-zinc-100 placeholder:text-zinc-500",
        "focus:border-orange-500 focus:outline-none",
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4", className)}>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="mx-auto size-8 animate-spin rounded-full border-2 border-zinc-700 border-t-orange-500"
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-200">
      {children}
    </p>
  );
}

export function Screen({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-24 pt-6">
      {title && <h1 className="mb-4 text-2xl font-bold text-zinc-50">{title}</h1>}
      {children}
    </main>
  );
}
