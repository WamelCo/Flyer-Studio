import Link from "next/link";

import { PRODUCT_NAME, Wordmark } from "@/components/shell/wordmark";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/dashboard", label: "Create a flyer" },
      { href: "/#examples", label: "Examples" },
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Your account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/projects", label: "Your projects" },
      { href: "/billing", label: "Billing & plan" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/#faq", label: "Questions & answers" },
      { href: "/#how-it-works", label: "How it works" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Use" },
    ],
  },
];

/**
 * Site footer in the product-page tradition: fine print first, a directory of links,
 * then the legal line. Quiet type on the base colour, separated by hairlines.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-separator bg-base text-caption text-fg-secondary">
      <div className="mx-auto flex max-w-(--content-max) flex-col gap-8 px-6 pt-8 pb-10">
        <div className="flex flex-col gap-2 border-b border-separator pb-6 leading-relaxed">
          <p>
            Generating three designs uses 5 credits — on the web or on WhatsApp; exports use 1–4 credits depending on
            format. Pro and Max are passes for 1 or 12 months, paid once through Paynow; nothing renews automatically.
            Prices are in US dollars.
          </p>
          <p>Stock photography is provided by Unsplash and credited to each photographer inside the editor.</p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-2">
              <h2 className="text-caption font-semibold text-fg">{column.title}</h2>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="focus-ring rounded-sm transition-colors hover:text-fg hover:underline underline-offset-2">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-4 border-t border-separator pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Wordmark className="[&_span:last-child]:text-callout [&>span:first-child]:size-6 [&>span:first-child>svg]:size-4" />
            <span>
              Copyright © {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="focus-ring rounded-sm hover:text-fg">
              Privacy Policy
            </Link>
            <span aria-hidden className="h-3 w-px bg-separator" />
            <Link href="/terms" className="focus-ring rounded-sm hover:text-fg">
              Terms of Use
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
