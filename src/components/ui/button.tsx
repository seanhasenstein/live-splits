import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger" | "gold" | "ink";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:pointer-events-none disabled:opacity-45";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand/90 active:bg-brand/80",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-line",
  subtle: "border border-ink/10 bg-transparent text-ink-2 hover:border-ink/20 hover:text-ink active:bg-ink/5",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-line",
  danger: "border border-danger/40 bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft",
  gold: "bg-gold text-gold-ink hover:bg-gold/90 active:bg-gold/80",
  ink: "bg-ink text-bg hover:bg-ink/90 active:bg-ink/80",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-10 px-3.5 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** Plain anchor version for downloads and external links. */
export function AnchorButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}
