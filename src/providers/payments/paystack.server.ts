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

async function paystackRequest(path: string, secretKey: string, init?: RequestInit) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || body?.status === false) {
    throw new Error(body?.message || `Payment provider error (${res.status})`);
  }
  return body;
}

export function createPaystackPayments(): PaymentsProvider {
  function secretKey() {
    const key = getProviderConfig().payments.paystack.secretKey;
    if (!key) throw new Error("Payments are not configured yet.");
    return key;
  }

  return {
    async initCheckout(input: PaymentsInitCheckoutInput): Promise<PaymentsInitCheckoutResult> {
      const body = await paystackRequest("/transaction/initialize", secretKey(), {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          amount: input.amount,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata ?? {},
        }),
      });
      const authorizationUrl = body.data?.authorization_url as string | undefined;
      if (!authorizationUrl) throw new Error("We couldn't open a secure checkout. Please try again.");
      return { authorizationUrl, reference: input.reference };
    },

    async verify(reference: string): Promise<PaymentsVerifyResult> {
      const body = await paystackRequest(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        secretKey(),
      );
      const tx = body.data ?? {};
      return {
        reference,
        status: tx.status === "success" ? "success" : tx.status === "failed" ? "failed" : "pending",
        amount: Number(tx.amount ?? 0),
        currency: tx.currency ?? "",
        customerCode: tx.customer?.customer_code ?? null,
        metadata: tx.metadata ?? {},
        raw: tx,
      };
    },

    async refund(input: PaymentsRefundInput): Promise<void> {
      await paystackRequest("/refund", secretKey(), {
        method: "POST",
        body: JSON.stringify({
          transaction: input.reference,
          ...(input.amount ? { amount: input.amount } : {}),
        }),
      });
    },

    async createRecipient(
      input: PaymentsCreateRecipientInput,
    ): Promise<PaymentsCreateRecipientResult> {
      const body = await paystackRequest("/transferrecipient", secretKey(), {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: input.name,
          account_number: input.accountNumber,
          bank_code: input.bankCode,
          currency: input.currency ?? "NGN",
        }),
      });
      return { recipientCode: body.data?.recipient_code, raw: body.data };
    },

    async transfer(input: PaymentsTransferInput): Promise<PaymentsTransferResult> {
      const body = await paystackRequest("/transfer", secretKey(), {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount: input.amount,
          recipient: input.recipientCode,
          reason: input.reason ?? "",
          reference: input.reference,
        }),
      });
      return {
        transferCode: body.data?.transfer_code,
        status: body.data?.status ?? "pending",
        raw: body.data,
      };
    },

    verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
      const secret = getProviderConfig().payments.paystack.webhookSecret || secretKey();
      if (!signatureHeader) return false;
      const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
      return hash === signatureHeader;
    },

    parseEvent(rawBody: string): PaymentsWebhookEvent {
      const json = JSON.parse(rawBody);
      return { type: json.event, reference: json.data?.reference, raw: json };
    },
  };
}
