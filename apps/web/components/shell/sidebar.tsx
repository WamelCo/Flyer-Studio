"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CreditCard, LayoutGrid, LogOut, PanelLeft, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useViewer } from "@/components/providers/viewer-provider";
import { useShell } from "@/components/shell/shell-provider";
import { LogoGlyph, PRODUCT_NAME } from "@/components/shell/wordmark";
import { RollingNumber } from "@/components/ui/rolling-number";
import { Tooltip } from "@/components/ui/tooltip";
import { SIDEBAR_WIDTH } from "@/lib/layout";
import { fadeVariants, transitions } from "@/lib/motion";
import { PLANS } from "@flyer/billing/plans";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Three destinations. The contract caps this at five; resist adding more.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Create", icon: Sparkles },
  { href: "/projects", label: "Projects", icon: LayoutGrid },
  { href: "/account", label: "Account", icon: UserRound },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Label({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="truncate whitespace-nowrap"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useShell();
  const { viewer } = useViewer();
  const plan = PLANS[viewer.plan];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
      transition={transitions.layout}
      className="material sticky top-0 z-30 hidden h-dvh shrink-0 flex-col overflow-hidden md:flex"
    >
      <div className="flex h-(--bar-height) items-center justify-between gap-2 px-3">
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div variants={fadeVariants} initial="initial" animate="animate" exit="exit">
              <Link href="/dashboard" className="focus-ring flex items-center gap-2 rounded-button pr-2">
                <LogoGlyph />
                <span className="text-headline whitespace-nowrap text-fg">{PRODUCT_NAME}</span>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
        <Tooltip content={collapsed ? "Show sidebar" : "Hide sidebar"} shortcut="⌘\" side="right">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!collapsed}
            className="focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-button text-fg-secondary hover:bg-fill hover:text-fg"
          >
            <PanelLeft className="size-5" />
          </button>
        </Tooltip>
      </div>

      <nav aria-label="Primary" className="mt-2 flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const link = (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? label : undefined}
              className={cn(
                "focus-ring relative flex h-10 items-center rounded-button text-callout font-medium",
                active ? "text-fg" : "text-fg-secondary hover:bg-fill hover:text-fg",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  transition={transitions.layout}
                  className="absolute inset-0 rounded-button bg-fill-strong"
                />
              )}
              <span className="relative grid size-10 shrink-0 place-items-center">
                <Icon className={cn("size-5", active && "text-accent-text")} />
              </span>
              <span className="relative min-w-0 pr-3">
                <Label show={!collapsed}>{label}</Label>
              </span>
            </Link>
          );
          return collapsed ? (
            <Tooltip key={href} content={label}>
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 p-3">
        <Link
          href="/billing"
          className={cn(
            "focus-ring flex items-center rounded-control hover:bg-fill",
            collapsed ? "h-10 justify-center" : "flex-col items-start gap-1 p-3",
          )}
          aria-label={`${viewer.credits} credits on the ${plan.name} plan`}
        >
          {collapsed ? (
            <RollingNumber value={viewer.credits} className="text-caption font-semibold text-fg" />
          ) : (
            <>
              <span className="text-caption text-fg-secondary whitespace-nowrap">Credits · {plan.name}</span>
              <RollingNumber value={viewer.credits} className="text-headline text-fg" />
            </>
          )}
        </Link>

        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "pl-1")}>
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-fill-strong text-caption font-semibold uppercase text-fg"
          >
            {viewer.email.charAt(0)}
          </span>
          {!collapsed && <span className="min-w-0 flex-1 truncate text-caption text-fg-secondary">{viewer.email}</span>}
          <form action="/auth/signout" method="post">
            <Tooltip content="Sign out">
              <button
                type="submit"
                aria-label="Sign out"
                className="focus-ring inline-flex size-8 items-center justify-center rounded-button text-fg-secondary hover:bg-fill hover:text-fg"
              >
                <LogOut className="size-4" />
              </button>
            </Tooltip>
          </form>
        </div>
      </div>
    </motion.aside>
  );
}

/** Below md the sidebar becomes a translucent bottom tab bar. */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="material fixed inset-x-0 bottom-0 z-30 flex justify-around pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring flex h-14 flex-1 flex-col items-center justify-center gap-1 text-caption font-medium",
              active ? "text-accent-text" : "text-fg-secondary",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileHeader() {
  const { viewer } = useViewer();
  return (
    <header className="material sticky top-0 z-30 flex h-(--bar-height) items-center justify-between px-4 md:hidden">
      <Link href="/dashboard" className="focus-ring flex items-center gap-2 rounded-button">
        <LogoGlyph />
        <span className="text-headline text-fg">{PRODUCT_NAME}</span>
      </Link>
      <Link href="/billing" className="focus-ring flex items-baseline gap-1 rounded-button text-callout text-fg-secondary">
        <RollingNumber value={viewer.credits} className="font-semibold text-fg" />
        credits
      </Link>
    </header>
  );
}
