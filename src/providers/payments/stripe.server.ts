import { createHmac } from "node:crypto";

import type {
  PaymentsCreateRecipientInput,
  PaymentsCreateRecipientResult,
  PaymentsInitCheckoutInput,
  PaymentsInitCheckoutResult,
  PaymentsProvider,
  PaymentsRefundInput,
  PaymentsTransferInput,
  PaymentsTransferResult,
  PaymentsVerifyResult,
  PaymentsWebhookEvent,
} from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

/**
 * Minimal Stripe adapter using Checkout Sessions + REST, no `stripe` SDK
 * dependency. Covers the same contract as the Paystack adapter so callers
 * can switch `PAYMENTS_PROVIDER=stripe` without code changes. Payouts
 * (`createRecipient`/`transfer`) map to Stripe Connect concepts and require
 * a connected account id passed as the recipient code.
 */

function secretKey() {
  const key = getProviderConfig().payments.stripe.secretKey;
  if (!key) throw new Error("Payments are not configured yet.");
  return key;
}

async function stripeRequest(path: string, body?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error?.message || `Payment provider error (${res.status})`);
  return json;
}

export function createStripePayments(): PaymentsProvider {
  return {
    async initCheckout(input: PaymentsInitCheckoutInput): Promise<PaymentsInitCheckoutResult> {
      const session = await stripeRequest("/checkout/sessions", {
        mode: "payment",
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(input.amount),
        "line_items[0][price_data][product_data][name]": "Payment",
        "line_items[0][quantity]": "1",
        customer_email: input.email,
        client_reference_id: input.reference,
        success_url: `${input.callbackUrl}?reference=${input.reference}`,
        cancel_url: input.callbackUrl,
        ...Object.fromEntries(
          Object.entries(input.metadata ?? {}).map(([k, v]) => [`metadata[${k}]`, String(v)]),
        ),
      });
      return { authorizationUrl: session.url, reference: input.reference };
    },

    async verify(reference: string): Promise<PaymentsVerifyResult> {
      const list = await stripeRequest(
        `/checkout/sessions?client_reference_id=${encodeURIComponent(reference)}&limit=1`,
      );
      const session = list.data?.[0];
      if (!session) return { reference, status: "pending", amount: 0, currency: "" };
      return {
        reference,
        status: session.payment_status === "paid" ? "success" : "pending",
        amount: Number(session.amount_total ?? 0),
        currency: (session.currency ?? "").toUpperCase(),
        customerCode: session.customer ?? null,
        metadata: session.metadata ?? {},
        raw: session,
      };
    },

    async refund(input: PaymentsRefundInput): Promise<void> {
      await stripeRequest("/refunds", {
        payment_intent: input.reference,
        ...(input.amount ? { amount: String(input.amount) } : {}),
      });
    },

    async createRecipient(
      input: PaymentsCreateRecipientInput,
    ): Promise<PaymentsCreateRecipientResult> {
      throw new Error(
        `Stripe Connect payouts aren't wired up yet — createRecipient() for "${input.name}" needs a connected account id.`,
      );
    },

    async transfer(input: PaymentsTransferInput): Promise<PaymentsTransferResult> {
      const transfer = await stripeRequest("/transfers", {
        amount: String(input.amount),
        currency: getProviderConfig().payments.currency.toLowerCase(),
        destination: input.recipientCode,
        ...(input.reference ? { transfer_group: input.reference } : {}),
      });
      return { transferCode: transfer.id, status: "pending", raw: transfer };
    },

    verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
      const secret = getProviderConfig().payments.stripe.webhookSecret;
      if (!signatureHeader || !secret) return false;
      const parts = Object.fromEntries(
        signatureHeader.split(",").map((p) => p.split("=") as [string, string]),
      );
      const signedPayload = `${parts.t}.${rawBody}`;
      const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
      return expected === parts.v1;
    },

    parseEvent(rawBody: string): PaymentsWebhookEvent {
      const json = JSON.parse(rawBody);
      return { type: json.type, reference: json.data?.object?.client_reference_id, raw: json };
    },
  };
}
