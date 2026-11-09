import { db, eq, user as users } from "@flyer/db";
import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CreateView } from "@/components/create/create-view";
import { requireViewer } from "@/lib/auth/viewer";
import { listProjects } from "@/lib/projects";

export const metadata: Metadata = { title: "Create" };

export default async function DashboardPage() {
  const viewer = await requireViewer("/dashboard");
  const [recentProjects, [account]] = await Promise.all([
    listProjects(8),
    db().select({ phone: users.phoneNumber, verified: users.phoneNumberVerified }).from(users).where(eq(users.id, viewer.id)).limit(1),
  ]);
  // Most people start on WhatsApp: an email account without a number may have a second,
  // WhatsApp-made account with their flyers and credits. Linking the number joins them.
  const suggestLink = !(account?.phone && account.verified);

  return (
    <>
      {suggestLink && (
        <div className="mx-auto w-full max-w-(--content-max) px-6 pt-6 md:px-10">
          <Link
            href="/account"
            className="focus-ring flex items-center gap-3 rounded-panel bg-surface px-4 py-3 text-callout text-fg shadow-card transition-colors hover:bg-fill"
          >
            <MessageCircle className="size-5 shrink-0 text-accent-text" aria-hidden />
            <span>
              Use Flyer Studio on WhatsApp? <span className="font-semibold">Link your number</span> — flyers, credits and passes from WhatsApp come here too.
            </span>
          </Link>
        </div>
      )}
      <CreateView recentProjects={recentProjects} />
    </>
  );
}
