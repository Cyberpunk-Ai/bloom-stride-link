/**
 * Server-side provider configuration. Every read happens lazily inside a
 * function so this module is safe to import from anywhere without leaking
 * secrets into the client bundle (Vite would otherwise inline any
 * module-scope `process.env` access performed at import time).
 */

function str(key: string, fallback = ""): string {
  const value = process.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function num(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function getProviderConfig() {
  return {
    providers: {
      db: str("DB_PROVIDER", "supabase"),
      auth: str("AUTH_PROVIDER", "supabase"),
      storage: str("STORAGE_PROVIDER", "supabase"),
      realtime: str("REALTIME_PROVIDER", "supabase"),
      ai: str("AI_PROVIDER", "gateway"),
      payments: str("PAYMENTS_PROVIDER", "paystack"),
      email: str("EMAIL_PROVIDER", "none"),
    },
    storage: {
      bucket: str("STORAGE_BUCKET", "media"),
      s3: {
        endpoint: str("S3_ENDPOINT"),
        region: str("S3_REGION", "auto"),
        accessKeyId: str("S3_ACCESS_KEY_ID"),
        secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
        publicBaseUrl: str("S3_PUBLIC_BASE_URL"),
      },
    },
    ai: {
      gatewayUrl: str("AI_GATEWAY_URL", "https://ai.gateway.lovable.dev/v1/chat/completions"),
      textModel: str("AI_TEXT_MODEL", "google/gemini-2.5-flash"),
      apiKey: str("AI_API_KEY") || str("LOVABLE_API_KEY"),
    },
    payments: {
      currency: str("PAYMENTS_CURRENCY", "USD"),
      baseCurrency: str("PAYMENTS_BASE_CURRENCY", "USD"),
      usdRate: num("PAYMENTS_USD_RATE", 1),
      minTipUsd: num("PAYMENTS_MIN_TIP_USD", 1),
      platformFeeBps: num("PAYMENTS_PLATFORM_FEE_BPS", 1000),
      minPayoutUsd: num("PAYMENTS_MIN_PAYOUT_USD", 10),
      paystack: {
        secretKey: str("PAYSTACK_SECRET_KEY"),
        webhookSecret: str("PAYSTACK_WEBHOOK_SECRET"),
        publicKey: str("VITE_PAYSTACK_PUBLIC_KEY"),
      },
      stripe: {
        secretKey: str("STRIPE_SECRET_KEY"),
        webhookSecret: str("STRIPE_WEBHOOK_SECRET"),
      },
    },
    email: {
      resendApiKey: str("RESEND_API_KEY"),
      fromAddress: str("EMAIL_FROM", str("VITE_SUPPORT_EMAIL", "no-reply@example.com")),
    },
  };
}

export type ProviderConfig = ReturnType<typeof getProviderConfig>;
