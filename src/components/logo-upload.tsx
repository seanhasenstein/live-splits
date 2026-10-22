"use client";

import { Upload } from "lucide-react";
import { useActionState, useRef } from "react";
import { type LogoState, uploadLogo } from "@/app/actions/logos";

/**
 * Choose an image and it's saved as the team's logo (trimmed and sized on the server). With no
 * `name`, it asks for the team's name first: a team not in our results yet.
 */
export function LogoUpload({ name, label = "Upload" }: { name?: string; label?: string }) {
  const [state, action, pending] = useActionState<LogoState, FormData>(uploadLogo, {});
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="flex flex-wrap items-center justify-end gap-2">
      {name ? <input type="hidden" name="name" value={name} /> : <input name="name" required maxLength={120} placeholder="Team name, as results print it" className="h-8 min-w-0 flex-1 basis-48 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink" />}
      <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2 focus-within:ring-2 focus-within:ring-brand/40 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        <Upload className="size-3.5" />
        {pending ? "Saving…" : label}
        <input type="file" name="file" accept="image/*" className="sr-only" onChange={(e) => {
            const f = form.current;
            // The form data is read as it submits, so the picker can be cleared right after: picking the same file again (after an error, or a missing name) still works.
            if (f && !f.checkValidity()) f.reportValidity();
            else f?.requestSubmit();
            e.target.value = "";
          }}
        />
      </label>
      {state.error && <span className="w-full text-right text-[12px] text-danger">{state.error}</span>}
    </form>
  );
}
