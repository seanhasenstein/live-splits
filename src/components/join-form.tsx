"use client";

import { useActionState } from "react";
import { joinAction } from "@/app/actions/auth";
import { Button, ErrorText, Field, Input } from "@/components/ui";

export function JoinForm() {
  const [state, action, pending] = useActionState(joinAction, {});
  return (
    <form action={action}>
      <Field label="Code">
        <Input
          name="code"
          placeholder="ABC-DEF"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          required
          className="font-mono text-xl tracking-widest"
        />
      </Field>
      <Field label="First name">
        <Input name="name" placeholder="Emma" autoComplete="given-name" required maxLength={40} />
      </Field>
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" disabled={pending} className="w-full py-3.5">
        {pending ? "Joining…" : "Join"}
      </Button>
    </form>
  );
}
