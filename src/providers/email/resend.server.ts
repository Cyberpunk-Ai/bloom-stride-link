import type { EmailProvider } from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

export function createResendEmail(): EmailProvider {
  return {
    async send(input) {
      const cfg = getProviderConfig();
      if (!cfg.email.resendApiKey) {
        throw new Error("Email isn't configured yet. Set RESEND_API_KEY.");
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.email.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from ?? cfg.email.fromAddress,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Email send failed (${res.status}): ${body}`);
      }
    },
  };
}
