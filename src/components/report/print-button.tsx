"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Download PDF: the browser's print dialog, where "Save as PDF" makes the file. The sheets are
 * laid out for Letter paper with no margins, so the PDF matches the page.
 */
export function PrintButton() {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Download className="size-4" />
      Download PDF
    </Button>
  );
}
