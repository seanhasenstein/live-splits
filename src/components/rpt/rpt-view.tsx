"use client";

import type { ReactNode } from "react";
import { Segmented } from "@/components/ui";
import { useLocalValue } from "@/lib/client/use-local-value";

/**
 * Web or Print layout on screen. Web is the app's look (Inter, light or dark); Print layout is the
 * PDF exactly. Printing always gives the PDF. Remembered on this device, shared with the other reports.
 */
export function RptView({ children }: { children: ReactNode }) {
  const [stored, store] = useLocalValue("ls_report_view");
  const view = stored === "paper" ? "paper" : "web";
  return (
    <>
      <div className="no-print mx-auto flex max-w-5xl justify-center px-4 pt-4">
        <Segmented
          value={view}
          onChange={store}
          options={[
            { value: "web", label: "Web" },
            { value: "paper", label: "Print layout" },
          ]}
          className="w-56"
        />
      </div>
      <main className={`rpt ${view === "web" ? "web" : ""} py-4 sm:px-4 print:p-0`}>{children}</main>
    </>
  );
}
