import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Small shared primitives in the Crusader style. Keep them boring.

export function Page({ title, back, children }: { title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-5">
      {back && (
        <Link href={back.href} className="text-sm text-green/70 underline-offset-2 hover:underline">
          ← {back.label}
        </Link>
      )}
      <h1 className="hairline-title mt-2 mb-5">{title}</h1>
      {children}
    </main>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-end justify-between border-b border-green pb-1">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-green/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-green/60">{hint}</span>}
    </label>
  );
}

const inputClass =
  "rounded border border-green/40 bg-white px-3 py-2.5 text-base text-green placeholder:text-green/40 focus:border-green focus:outline-none focus:ring-2 focus:ring-gold-soft";

// Full width unless the caller sets a width.
const withWidth = (className = "") => `${inputClass} ${/\bw-/.test(className) ? "" : "w-full"} ${className}`;

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={withWidth(props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={withWidth(props.className)} />;
}

type ButtonVariant = "primary" | "secondary" | "danger";
const buttonClass: Record<ButtonVariant, string> = {
  primary: "bg-green text-cream hover:bg-green/90 disabled:bg-green/40",
  secondary: "border border-green text-green hover:bg-green/5 disabled:opacity-40",
  danger: "border border-red-700 text-red-700 hover:bg-red-50 disabled:opacity-40",
};

export function Button({ variant = "primary", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition ${buttonClass[variant]} ${props.className ?? ""}`}
    />
  );
}

export function LinkButton({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={`inline-block rounded px-4 py-2.5 text-center text-sm font-bold uppercase tracking-wider transition ${buttonClass[variant]} ${className}`}
    />
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  return children ? <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p> : null;
}

/** Tabular numerals everywhere a time appears. */
export function Time({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{children}</span>;
}
