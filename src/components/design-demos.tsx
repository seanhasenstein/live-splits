"use client";

import { useState } from "react";
import { Button, Segmented, Sheet } from "@/components/ui";

export function SegmentedDemo() {
  const [v, setV] = useState("girls");
  return (
    <Segmented
      value={v}
      onChange={setV}
      options={[
        { value: "girls", label: "Girls" },
        { value: "boys", label: "Boys" },
      ]}
    />
  );
}

export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open sheet
      </Button>
      {open && (
        <Sheet title="Elanore Faucher" subtitle="Mile 2 · recorded by Sean" onClose={() => setOpen(false)}>
          <div className="grid grid-cols-4 gap-2">
            {["−1s", "−0.5s", "+0.5s", "+1s"].map((l) => (
              <Button key={l} variant="secondary" size="lg">
                {l}
              </Button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
