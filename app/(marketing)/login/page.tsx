import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { enabledProviders } from "@/lib/auth/providers";
import { safeNext } from "@/lib/auth/safe-next";
import { supabaseEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? params.error : undefined;
  const providers = await enabledProviders();

  return (
    <section className="flex min-h-[calc(100dvh-var(--bar-height))] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-panel bg-surface p-6 shadow-card sm:p-10">
        <LoginForm
          next={next}
          initialError={error}
          configured={Boolean(supabaseEnv())}
          googleEnabled={providers.google}
        />
      </div>
    </section>
  );
}
