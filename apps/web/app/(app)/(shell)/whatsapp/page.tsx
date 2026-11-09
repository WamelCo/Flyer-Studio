import { redirect } from "next/navigation";

/** The WhatsApp settings live on the Account page now. */
export default function WhatsAppPage() {
  redirect("/account");
}
