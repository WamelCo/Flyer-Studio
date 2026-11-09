import Link from "next/link";

import { PRODUCT_NAME, Wordmark } from "@/components/shell/wordmark";
import { ButtonLink } from "@/components/ui/button";

const LINKS = [
  { href: "/#examples", label: "Examples" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

/** Global navigation: a quiet translucent bar, product name left, sections centred, actions right. */
export function SiteHeader() {
  return (
    <header className="material sticky top-0 z-30">
      <nav aria-label="Main" className="mx-auto grid h-(--bar-height) max-w-(--content-max) grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
        <Link href="/" className="focus-ring justify-self-start rounded-button" aria-label={`${PRODUCT_NAME} home`}>
          <Wordmark />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="focus-ring rounded-button px-3 py-2 text-callout text-fg/80 transition-colors hover:text-fg">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="col-start-3 flex items-center justify-self-end gap-2">
          <Link
            href="/login"
            className="focus-ring hidden whitespace-nowrap rounded-button px-3 py-2 text-callout text-fg/80 transition-colors hover:text-fg sm:inline-flex"
          >
            Sign in
          </Link>
          <ButtonLink href="/dashboard" size="sm" shape="capsule">
            Start creating
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}
