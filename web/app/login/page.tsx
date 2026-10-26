"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "@/lib/api";
import { LogoMark } from "@/components/icons";
import { ErrorBar, Spinner } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-10 sm:pt-20">
      <LogoMark className="size-14" />
      <h1 className="text-2xl font-semibold tracking-tight">登录 PodEcho</h1>
      <form onSubmit={submit} className="w-full space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="访问密码"
          aria-label="访问密码"
          autoComplete="current-password"
          autoFocus
          className="field h-12 w-full rounded-full px-5"
        />
        <button
          type="submit"
          disabled={busy || !password}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground font-medium text-background transition-opacity disabled:opacity-35"
        >
          {busy ? <><Spinner /> 登录中</> : "登录"}
        </button>
      </form>
      <div className="w-full">
        <ErrorBar message={error} onClose={() => setError(null)} />
      </div>
    </div>
  );
}
