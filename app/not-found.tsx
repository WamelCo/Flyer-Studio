import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-caption font-semibold text-accent-text">404</p>
      <h1 className="text-title text-fg">This page isn&rsquo;t here.</h1>
      <p className="max-w-(--prose-max) text-body text-fg-secondary">
        The link may be old, or the flyer may belong to another account.
      </p>
      <ButtonLink href="/dashboard" size="lg">
        Back to Flyer Studio
      </ButtonLink>
    </main>
  );
}
