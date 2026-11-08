import Link from "next/link";
import type { ReactNode } from "react";

import { PRODUCT_NAME, Wordmark } from "@/components/shell/wordmark";
import { ButtonLink } from "@/components/ui/button";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="material sticky top-0 z-30">
        <nav
          aria-label="Main"
          className="mx-auto flex h-(--bar-height) max-w-(--content-max) items-center justify-between gap-4 px-6"
        >
          <Link href="/" className="focus-ring rounded-button" aria-label={`${PRODUCT_NAME} home`}>
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="focus-ring hidden rounded-button px-3 py-2 text-callout text-fg-secondary hover:text-fg sm:inline-flex"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="focus-ring hidden whitespace-nowrap rounded-button px-3 py-2 text-callout text-fg-secondary hover:text-fg sm:inline-flex"
            >
              Sign in
            </Link>
            <ButtonLink href="/dashboard" size="sm" shape="capsule">
              Start creating
            </ButtonLink>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-separator">
        <div className="mx-auto flex max-w-(--content-max) flex-col gap-2 px-6 py-8 text-caption text-fg-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {PRODUCT_NAME}
          </span>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-fg">
              Pricing
            </Link>
            <Link href="/login" className="hover:text-fg">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
