import { formatPhone, isPhoneEmail, studioNumber, whatsappGatewayConfigured } from "@flyer/auth";
import { whatsappStatus } from "@flyer/auth/gateway";
import { db, eq, user as users } from "@flyer/db";
import type { Metadata } from "next";

import { WhatsAppLink } from "@/components/whatsapp/whatsapp-link";
import { PageHeader } from "@/components/shell/page-header";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppPage() {
  const viewer = await requireViewer("/whatsapp");
  // From the database, not the session cookie (cached for 5 minutes), so a new link shows at once.
  const [user] = await db()
    .select({ email: users.email, phoneNumber: users.phoneNumber, phoneNumberVerified: users.phoneNumberVerified })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);
  const linked = user?.phoneNumberVerified && user.phoneNumber ? user.phoneNumber : null;
  const status = await whatsappStatus();

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-6 py-8 md:px-10 md:py-12">
      <PageHeader title="WhatsApp" description="Make flyers by sending a message: describe it, get three designs back in the chat." />
      <WhatsAppLink
        linked={linked}
        // An account made by a WhatsApp sign-in has no email to fall back on, so it can't unlink.
        canUnlink={Boolean(linked) && !isPhoneEmail(user?.email)}
        available={whatsappGatewayConfigured()}
        studioNumber={(status?.state === "ready" && status.number) || studioNumber()}
        studioLabel={formatPhone((status?.state === "ready" && status.number) || studioNumber() || "")}
        connected={status?.state === "ready"}
      />
    </div>
  );
}
