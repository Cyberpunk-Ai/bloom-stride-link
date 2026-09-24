/**
 * Single, race-safe settlement path used by both the browser confirm step and
 * the provider webhook. The conditional "status <> success" update means only
 * one caller can ever win, so tips/plans/ledger rows are never double-recorded.
 */
type Tx = {
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  paid_at?: string;
  metadata?: Record<string, any>;
  customer?: { customer_code?: string };
  authorization?: Record<string, any>;
};

export function platformFeeBps() {
  const v = Number(process.env["PAYMENTS_PLATFORM_FEE_BPS"] ?? 1000);
  return Number.isFinite(v) && v >= 0 && v <= 5000 ? v : 1000;
}

export async function settleSuccessfulCharge(admin: any, tx: Tx) {
  const reference = String(tx.reference ?? "");
  if (!reference) return { settled: false as const, reason: "no-reference" };

  const { data: payment } = await admin
    .from("payments")
    .select("id, user_id, plan, billing_cycle, amount, currency, status")
    .eq("reference", reference)
    .maybeSingle();
  if (!payment) return { settled: false as const, reason: "unknown" };

  // Amount/currency must match what we asked the provider to charge.
  if (Number(tx.amount) !== Number(payment.amount) || (tx.currency && tx.currency !== payment.currency)) {
    await admin.from("payments").update({ status: "amount_mismatch", raw: tx }).eq("id", payment.id).neq("status", "success");
    return { settled: false as const, reason: "amount-mismatch" };
  }

  const amountMinor = Number(payment.amount);
  const feeMinor = Math.round((amountMinor * platformFeeBps()) / 10000);

  const { data: won } = await admin
    .from("payments")
    .update({
      status: "success",
      raw: tx,
      paid_at: tx.paid_at ?? new Date().toISOString(),
      amount_minor: amountMinor,
      platform_fee_minor: payment.plan === "tip" ? feeMinor : amountMinor,
    })
    .eq("id", payment.id)
    .neq("status", "success")
    .select("id");
  if (!won || won.length === 0) return { settled: false as const, reason: "already-settled", payment };

  const meta = tx.metadata ?? {};
  const currency = payment.currency;

  if (payment.plan === "tip") {
    const recipient = String(meta["recipient_id"] ?? "");
    if (recipient) {
      const net = amountMinor - feeMinor;
      await admin.from("tips").insert({
        from_user_id: payment.user_id,
        to_user_id: recipient,
        amount: Number(meta["tip_usd"] ?? 0),
        amount_minor: amountMinor,
        fee_minor: feeMinor,
        net_minor: net,
        currency,
        status: "settled",
        reference,
        message: String(meta["note"] ?? "").slice(0, 240),
        post_id: meta["post_id"] ?? null,
      });
      await admin.from("ledger_entries").insert([
        { user_id: recipient, kind: "tip", direction: "credit", amount_minor: net, currency, status: "available", reference, memo: "Tip received" },
        { user_id: recipient, kind: "platform_fee", direction: "debit", amount_minor: feeMinor, currency, status: "available", reference: `${reference}:fee`, memo: "Platform fee" },
      ]);
      await admin.from("notifications").insert({
        recipient_id: recipient,
        actor_id: payment.user_id,
        type: "tip",
        body: `sent you a $${Number(meta["tip_usd"] ?? 0)} tip`,
      });
    }
    return { settled: true as const, kind: "tip" as const, payment, meta };
  }

  const plan = String(meta["plan"] ?? payment.plan ?? "plus");
  const cycle = String(meta["billing_cycle"] ?? payment.billing_cycle ?? "monthly");
  await admin.from("profiles").update({ plan }).eq("id", payment.user_id);
  const a = tx.authorization;
  await admin.from("subscriptions").upsert(
    {
      user_id: payment.user_id,
      plan,
      billing_cycle: cycle,
      status: "active",
      provider: "paystack",
      provider_customer_id: tx.customer?.customer_code ?? null,
      renews_at: new Date(Date.now() + (cycle === "annual" ? 365 : 30) * 86400000).toISOString(),
      payment_method: a
        ? { brand: a["card_type"] ?? a["channel"] ?? "card", last4: a["last4"] ?? "", exp: `${a["exp_month"] ?? ""}/${a["exp_year"] ?? ""}` }
        : {},
    },
    { onConflict: "user_id" },
  );
  return { settled: true as const, kind: "plan" as const, payment, meta, plan, cycle };
}

/** Refunds and chargebacks: mark the payment, reverse creator credit, downgrade plans. */
export async function reverseCharge(admin: any, reference: string, refundedMinor: number | null, reason: string) {
  const { data: payment } = await admin.from("payments").select("id, user_id, plan, amount, currency").eq("reference", reference).maybeSingle();
  if (!payment) return;
  const refunded = refundedMinor ?? Number(payment.amount);
  await admin.from("payments").update({ status: reason, refunded_minor: refunded }).eq("id", payment.id);

  if (payment.plan === "tip") {
    const { data: tip } = await admin.from("tips").select("id, to_user_id, net_minor").eq("reference", reference).maybeSingle();
    if (tip) {
      await admin.from("tips").update({ status: "reversed" }).eq("id", tip.id);
      await admin.from("ledger_entries").upsert(
        { user_id: tip.to_user_id, kind: "reversal", direction: "debit", amount_minor: Number(tip.net_minor ?? 0), currency: payment.currency, status: "available", reference: `${reference}:reversal`, memo: `Tip ${reason}` },
        { onConflict: "kind,reference", ignoreDuplicates: true },
      );
    }
  } else if (refunded >= Number(payment.amount)) {
    await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", payment.user_id);
    await admin.from("profiles").update({ plan: "free" }).eq("id", payment.user_id);
  }
}
