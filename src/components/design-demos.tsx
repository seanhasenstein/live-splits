"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Segmented, Sheet } from "@/components/ui";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const current = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(current === "dark" ? "light" : "dark");
  };
  return (
    <Button variant="secondary" size="sm" onClick={toggle}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      Theme
    </Button>
  );
}

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
