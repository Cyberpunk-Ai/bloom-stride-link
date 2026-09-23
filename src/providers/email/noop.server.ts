import type { EmailProvider } from "@/providers/types";

/** Default when `EMAIL_PROVIDER=none`: logs instead of sending. */
export function createNoopEmail(): EmailProvider {
  return {
    async send(input) {
      console.warn(`[email:noop] Would send "${input.subject}" to ${input.to}`);
    },
  };
}
