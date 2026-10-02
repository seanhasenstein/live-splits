import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { APP_NAME } from "@/config/app";

/**
 * Top bar: shield + app name, or a back link + page title when deeper in.
 * `right` holds the session menu or page actions.
 */
export function AppHeader({
  title,
  titleHref,
  subtitle,
  back,
  right,
}: {
  title?: ReactNode;
  /** Makes the title a link (e.g. back to the meet). */
  titleHref?: string;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        {back ? (
          <Link href={back.href} className="-ml-2 flex items-center gap-0.5 rounded-md py-1 pr-2 pl-1 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ChevronLeft className="size-4" />
            {back.label}
          </Link>
        ) : (
          <Link href="/" className="flex items-center gap-2.5">
            <Shield className="h-7" />
            <span className={`text-[15px] font-semibold text-ink ${title ? "hidden sm:inline" : ""}`}>{APP_NAME}</span>
          </Link>
        )}
        {title && (
          <div className="min-w-0 flex-1 border-l border-line pl-3">
            {titleHref ? (
              <Link href={titleHref} className="block truncate text-sm font-semibold text-ink hover:underline">
                {title}
              </Link>
            ) : (
              <div className="truncate text-sm font-semibold text-ink">{title}</div>
            )}
            {subtitle && <div className="truncate text-xs text-ink-2">{subtitle}</div>}
          </div>
        )}
        {!title && <div className="flex-1" />}
        {right}
      </div>
    </header>
  );
}

export function Shield({ className = "h-8" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/shield.svg" alt="" className={`w-auto ${className}`} />;
}

/** Page body with the standard gutter and width. */
export function Page({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <main className={`mx-auto w-full flex-1 px-4 py-5 ${wide ? "max-w-5xl" : "max-w-xl"} ${className}`}>{children}</main>;
}

export function PageTitle({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
