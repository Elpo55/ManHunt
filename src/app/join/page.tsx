"use client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { Button, Field, Input, Notice, Panel } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { toAppError } from "@/lib/errors";
import { useQueryParam } from "@/lib/useQueryParam";

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function JoinInner() {
  const router = useRouter();
  const fromLink = useQueryParam("code");
  const [code, setCode] = useState((fromLink ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  async function join(c: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinRoom(c);
      router.replace(`/lobby/?room=${r.room_id}`);
    } catch (e) {
      setError(toAppError(e).message);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoTried.current && fromLink && CODE_RE.test(fromLink.toUpperCase())) {
      autoTried.current = true;
      void join(fromLink.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLink]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void join(code);
  }

  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  return (
    <div className="mx-auto max-w-md space-y-5 pt-4">
      <div>
        <h1 className="text-2xl font-semibold">Rejoindre un salon</h1>
        <p className="mt-1 text-fog">Entrez le code communiqué par l&apos;hôte.</p>
      </div>
      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Code du salon" htmlFor="code" hint="6 caractères, sans O, I, 0 ni 1.">
            <Input
              id="code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={normalized}
              onChange={(e) => setCode(e.target.value)}
              className="num h-16 text-center text-3xl tracking-[0.35em]"
              placeholder="K7M2QX"
              aria-invalid={normalized.length === 6 && !CODE_RE.test(normalized)}
            />
          </Field>
          <Button type="submit" size="lg" block loading={busy} disabled={!CODE_RE.test(normalized)}>
            Rejoindre
          </Button>
        </form>
      </Panel>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export default function JoinPage() {
  return (
    <AppShell>
      <Suspense>
        <JoinInner />
      </Suspense>
    </AppShell>
  );
}
