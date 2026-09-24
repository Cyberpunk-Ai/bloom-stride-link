import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

type PaystackEvent = {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    paid_at?: string;
    amount?: number;
    currency?: string;
    customer?: { customer_code?: string };
    authorization?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    transfer_code?: string;
    reason?: string;
  };
};

function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Paystack webhook. Verifies the provider signature over the raw body before
 * touching any data, then settles the matching payment / payout row.
 */
export const Route = createFileRoute("/api/public/paystack/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["PAYSTACK_SECRET_KEY"];
        if (!secret) {
          console.error("[paystack] webhook received but PAYSTACK_SECRET_KEY is not configured");
          return new Response("Not configured", { status: 503 });
        }

        const rawBody = await request.text();
        if (!verifySignature(rawBody, request.headers.get("x-paystack-signature"), secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: PaystackEvent;
        try {
          payload = JSON.parse(rawBody) as PaystackEvent;
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }

        const event = payload.event ?? "";
        const tx = payload.data ?? {};
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;

        // Idempotency: every provider event is processed at most once.
        const eventId = `${event}:${tx.reference ?? tx.transfer_code ?? ""}:${(tx as any).id ?? ""}`;
        const { error: dupErr } = await admin
          .from("provider_events")
          .insert({ provider: "paystack", event_id: eventId, event_type: event, payload: payload as any });
        if (dupErr) return new Response("ok"); // already seen

        // ---- payouts (transfers) ----
        if (event.startsWith("transfer.")) {
          const status = event === "transfer.success" ? "paid" : event === "transfer.reversed" ? "reversed" : "failed";
          if (tx.transfer_code) {
            await admin.from("payouts").update({
              status,
              processed_at: new Date().toISOString(),
              ...(status === "failed" ? { failure_reason: tx.reason ?? "Transfer failed" } : {}),
            }).eq("transfer_code", tx.transfer_code);
          }
        } else if (event === "refund.processed" || event === "charge.dispute.create") {
          const ref = String((tx as any).transaction_reference ?? (tx as any).transaction?.reference ?? tx.reference ?? "");
          if (ref) {
            const { reverseCharge } = await import("@/lib/payments-settle.server");
            await reverseCharge(admin, ref, Number((tx as any).amount) || null, event === "refund.processed" ? "refunded" : "disputed");
          }
        } else if (event === "subscription.disable" || event === "subscription.not_renew") {
          const code = tx.customer?.customer_code;
          if (code) await admin.from("subscriptions").update({ status: "canceled" }).eq("provider_customer_id", code);
        } else if (event === "charge.success" && tx.status === "success" && tx.reference) {
          const { settleSuccessfulCharge } = await import("@/lib/payments-settle.server");
          await settleSuccessfulCharge(admin, tx);
        }

        await admin.from("provider_events").update({ processed_at: new Date().toISOString() })
          .eq("provider", "paystack").eq("event_id", eventId);
        return new Response("ok");
      },
    },
  },
});
