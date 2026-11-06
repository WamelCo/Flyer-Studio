"use client";

import { Button, ButtonLink } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-title text-fg">Something went wrong.</h1>
      <p className="max-w-(--prose-max) text-body text-fg-secondary">
        Your work is saved. Try again, and if it keeps happening, head back to your projects.
      </p>
      <div className="flex gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/projects" size="lg" variant="secondary">
          Projects
        </ButtonLink>
      </div>
    </main>
  );
}
