import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type PlanTier = "plus" | "pro";
type BillingCycle = "monthly" | "annual";

/** Plan prices in whole units of PAYMENTS_CURRENCY, overridable per env (e.g. PRICE_PLUS_MONTHLY). */
const DEFAULT_PRICES: Record<PlanTier, Record<BillingCycle, number>> = {
  plus: { monthly: 1170, annual: 10920 },
  pro: { monthly: 3770, annual: 35880 },
};

function money(plan: PlanTier, cycle: BillingCycle) {
  const v = Number(process.env[`PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PRICES[plan][cycle];
}

function chargeCurrency() {
  return process.env["PAYMENTS_CURRENCY"] || process.env["PAYSTACK_CURRENCY"] || "KES";
}

/** How many units of the charge currency equal one USD. */
function usdRate() {
  const v = Number(process.env["PAYMENTS_USD_RATE"] ?? process.env["PAYSTACK_USD_RATE"] ?? 130);
  return Number.isFinite(v) && v > 0 ? v : 130;
}

function minTipUsd() {
  const v = Number(process.env["PAYMENTS_MIN_TIP_USD"] ?? 0.1);
  return Number.isFinite(v) && v > 0 ? v : 0.1;
}

function paystackKey() {
  const key = process.env["PAYSTACK_SECRET_KEY"];
  if (!key) throw new Error("Payments are not configured yet.");
  return key;
}

async function paystack(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${paystackKey()}`,
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

export const startPaystackCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plan: PlanTier; cycle: BillingCycle; origin: string }) => {
    if (input.plan !== "plus" && input.plan !== "pro") throw new Error("Unknown plan");
    if (input.cycle !== "monthly" && input.cycle !== "annual") throw new Error("Unknown cycle");
    if (!/^https?:\/\//.test(input.origin)) throw new Error("Invalid origin");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as any;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Complete your profile before upgrading.");

    const email = claims?.email ?? `${profile.id}@users.noreply.app`;
    const currency = chargeCurrency();
    const amount = money(data.plan, data.cycle) * 100;
    const reference = `sub_${crypto.randomUUID().replace(/-/g, "")}`;

    const init = await paystack("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount,
        currency,
        reference,
        callback_url: `${data.origin}/billing/callback`,
        metadata: {
          profile_id: profile.id,
          plan: data.plan,
          billing_cycle: data.cycle,
        },
      }),
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("payments").insert({
      user_id: profile.id,
      reference,
      plan: data.plan,
      billing_cycle: data.cycle,
      amount,
      currency,
      email,
      status: "pending",
      authorization_url: init.data?.authorization_url ?? null,
    });

    return {
      authorizationUrl: init.data?.authorization_url as string,
      reference,
    };
  });

/**
 * Starts a real, paid tip. The tip is only recorded for the creator once
 * Paystack confirms the charge (callback or webhook).
 */
export const startTipCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      recipientUsername: string;
      amount: number;
      message?: string;
      postId?: string | null;
      origin: string;
    }) => {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount < 0.01 || amount > 1000) {
        throw new Error("Tip amount must be between $0.01 and $1000.");
      }
      if (!input.recipientUsername) throw new Error("Pick someone to tip.");
      if (!/^https?:\/\//.test(input.origin)) throw new Error("Invalid origin");
      return { ...input, amount: Math.round(amount * 100) / 100 };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as any;

    const { data: me } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!me?.id) throw new Error("Complete your profile before sending a tip.");
    const myProfileId = String(me.id);

    const cleanUsername = data.recipientUsername.replace(/^@/, "");
    const { data: recipient } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", cleanUsername)
      .maybeSingle();
    if (!recipient?.id) throw new Error("We couldn't find that creator.");
    const recipientId = String(recipient.id);

    if (recipientId === myProfileId) throw new Error("You can't tip yourself.");

    const email = claims?.email ?? `${myProfileId}@users.noreply.app`;
    const currency = chargeCurrency();
    if (data.amount < minTipUsd()) throw new Error(`The smallest tip is $${minTipUsd()}.`);
    // Exact minor units (cents) so sub-dollar tips are charged precisely.
    const amount = Math.max(1, Math.round(data.amount * usdRate() * 100));
    const reference = `tip_${crypto.randomUUID().replace(/-/g, "")}`;

    const init = await paystack("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount,
        currency,
        reference,
        callback_url: `${data.origin}/billing/callback`,
        metadata: {
          kind: "tip",
          profile_id: myProfileId,
          recipient_id: recipientId,
          recipient_username: cleanUsername,
          tip_usd: data.amount,
          note: (data.message ?? "").slice(0, 240),
          post_id: data.postId ?? null,
        },
      }),
    });
    const authUrl = init.data?.authorization_url as string | undefined;
    if (!authUrl) throw new Error("We couldn't open a secure checkout. Please try again.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("payments").insert({
      user_id: myProfileId,
      reference,
      plan: "tip",
      billing_cycle: "one_time",
      amount,
      currency,
      email,
      status: "pending",
      authorization_url: authUrl,
      raw: { recipient_username: cleanUsername, recipient_id: recipientId, tip_usd: data.amount },
    });

    return {
      authorizationUrl: authUrl,
      reference,
    };
  });

/** Confirms a Paystack reference and activates the plan. Safe to call twice. */
export const confirmPaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reference: string }) => {
    if (!input.reference || input.reference.length > 128) throw new Error("Invalid reference");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (!profile?.id) throw new Error("Sign in to confirm this payment.");
    const profileId = String(profile.id);

    let tx: any = {};
    let meta: any = {};
    let success = true;

    try {
      const verified = await paystack(`/transaction/verify/${encodeURIComponent(data.reference)}`);
      tx = verified.data ?? {};
      meta = tx.metadata ?? {};
      success = tx.status === "success";
    } catch (verifyErr) {
      // Never grant a plan or record a tip we could not verify with Paystack.
      console.error("Paystack verify failed:", verifyErr);
      throw new Error(
        "We couldn't confirm that payment with the payment provider. Nothing was charged to your plan — please try again.",
      );
    }

    if (meta.profile_id && String(meta.profile_id) !== profileId) {
      throw new Error("This payment belongs to another account.");
    }

    const isTip = meta.kind === "tip" || data.reference.startsWith("tip_");
    const plan = (meta.plan as PlanTier) ?? "plus";
    const cycle = (meta.billing_cycle as BillingCycle) ?? "annual";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    if (!success) {
      await admin.from("payments").update({ status: tx.status ?? "failed", raw: tx })
        .eq("reference", data.reference).neq("status", "success");
      return { status: tx.status ?? "failed", kind: isTip ? "tip" : "plan", plan, cycle };
    }

    const { settleSuccessfulCharge } = await import("@/lib/payments-settle.server");
    const result = await settleSuccessfulCharge(admin, tx);
    if (!result.settled && result.reason !== "already-settled") {
      throw new Error("We couldn't match that payment to your order. Please contact support.");
    }

    if (isTip) {
      return {
        status: "success" as const,
        kind: "tip" as const,
        plan,
        cycle,
        recipient: meta.recipient_username as string,
        amount: Number(meta.tip_usd ?? 0),
      };
    }
    return { status: "success" as const, kind: "plan" as const, plan, cycle };
  });

export const listMyPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data } = await supabase
      .from("payments")
      .select("id, reference, plan, billing_cycle, amount, currency, status, paid_at, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    return data ?? [];
  });
