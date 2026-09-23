import type { AiChatMessage, AiProvider } from "@/providers/types";
import { getProviderConfig } from "@/providers/env";

/**
 * Works with any OpenAI-compatible chat-completions endpoint: the Lovable AI
 * gateway by default, or a self-hosted / OpenAI / OpenRouter base URL when
 * `AI_GATEWAY_URL`, `AI_TEXT_MODEL` and `AI_API_KEY` are overridden.
 */
export function createOpenAiCompatible(): AiProvider {
  return {
    async chat(messages: AiChatMessage[]): Promise<string> {
      const { ai } = getProviderConfig();
      if (!ai.apiKey) {
        throw new Error("The AI assistant isn't configured yet. Add an AI key to enable it.");
      }

      const res = await fetch(ai.gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ai.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: ai.textModel, messages }),
      });

      if (res.status === 429) throw new Error("AI is busy right now — try again in a moment.");
      if (res.status === 402) {
        throw new Error("AI credits have run out for this workspace. Top up to keep generating.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error("The AI assistant isn't authorised. Check the AI key settings.");
      }
      if (res.status === 400) throw new Error(`The AI model "${ai.textModel}" isn't available.`);
      if (!res.ok) throw new Error(`AI request failed (${res.status})`);

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content?.trim() ?? "";
    },
  };
}
