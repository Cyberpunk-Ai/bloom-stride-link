/**
 * Provider factories. Server-only entry point: pick the concrete adapter for
 * each concern based on env vars, with a clear error when required
 * credentials are missing. Call sites (server functions, API routes) should
 * import from here instead of talking to a vendor SDK directly.
 *
 * Factories are async so each adapter module (and its secrets) is only
 * loaded when actually selected.
 */
import type { AiProvider, EmailProvider, PaymentsProvider, StorageProvider } from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

export async function getStorage(): Promise<StorageProvider> {
  const { providers } = getProviderConfig();
  switch (providers.storage) {
    case "s3":
    case "r2": {
      const { createS3Storage } = await import("@/providers/storage/s3.server");
      return createS3Storage();
    }
    case "supabase": {
      const { createSupabaseStorage } = await import("@/providers/storage/supabase.server");
      return createSupabaseStorage();
    }
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${providers.storage}". Use "supabase", "s3" or "r2".`);
  }
}

export async function getAi(): Promise<AiProvider> {
  const { providers } = getProviderConfig();
  switch (providers.ai) {
    case "gateway":
    case "openai":
    case "openai-compatible": {
      const { createOpenAiCompatible } = await import("@/providers/ai/openai-compatible.server");
      return createOpenAiCompatible();
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${providers.ai}". Use "gateway", "openai" or "openai-compatible".`,
      );
  }
}

export async function getPayments(): Promise<PaymentsProvider> {
  const { providers } = getProviderConfig();
  switch (providers.payments) {
    case "paystack": {
      const { createPaystackPayments } = await import("@/providers/payments/paystack.server");
      return createPaystackPayments();
    }
    case "stripe": {
      const { createStripePayments } = await import("@/providers/payments/stripe.server");
      return createStripePayments();
    }
    default:
      throw new Error(`Unknown PAYMENTS_PROVIDER "${providers.payments}". Use "paystack" or "stripe".`);
  }
}

export async function getEmail(): Promise<EmailProvider> {
  const { providers } = getProviderConfig();
  switch (providers.email) {
    case "none": {
      const { createNoopEmail } = await import("@/providers/email/noop.server");
      return createNoopEmail();
    }
    case "resend": {
      const { createResendEmail } = await import("@/providers/email/resend.server");
      return createResendEmail();
    }
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${providers.email}". Use "none" or "resend".`);
  }
}
