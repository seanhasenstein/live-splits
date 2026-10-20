"use client";

import type { ReactNode } from "react";
import { Segmented } from "@/components/ui";
import { useLocalValue } from "@/lib/client/use-local-value";

/**
 * Web or Print layout for the reports on screen. Web follows the app's light or dark theme and
 * the screen's width; Print layout shows the Letter pages as they'll print. Printing always gives
 * the Letter pages. Remembered on this device.
 */
export function ReportView({ children }: { children: ReactNode }) {
  const [stored, store] = useLocalValue("ls_report_view");
  const view = stored === "paper" ? "paper" : "web";
  return (
    <div className={view === "web" ? "report-web" : ""}>
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
      <main className="px-0 py-4 sm:px-4 print:p-0">{children}</main>
    </div>
  );
}
