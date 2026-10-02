"use client";

import { useActionState } from "react";
import { joinAction } from "@/app/actions/auth";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const [state, action, pending] = useActionState(joinAction, {});
  return (
    <Card>
      <form action={action}>
        <CardBody className="space-y-4 border-t-0">
          <Field label="Code">
            <Input
              name="code"
              defaultValue={initialCode}
              placeholder="ABC-DEF"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              required
              className="h-12 font-mono text-xl tracking-[0.2em]"
            />
          </Field>
          <Field label="First name" hint="Goes on every time you record.">
            <Input name="name" placeholder="Emma" autoComplete="given-name" required maxLength={40} />
          </Field>
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Joining…" : "Join"}
          </Button>
        </CardBody>
      </form>
    </Card>
  );
}
