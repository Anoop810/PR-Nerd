import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "./types.js";
import {
  GeminiProvider,
  type GeminiProviderOptions,
} from "./gemini.js";

export type { LLMProvider, ChatRequest, ChatResponse, LLMMessage } from "./types.js";
export {
  GeminiProvider,
  resolveGeminiApiKey,
  toGeminiRequestParts,
} from "./gemini.js";

export type ProviderOptions = {
  apiKey?: string;
};

/**
 * Stubs for future providers — keep the abstraction stable.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      "AnthropicProvider is not implemented. Use provider: gemini.",
    );
  }
}

export class XAIProvider implements LLMProvider {
  readonly name = "xai";
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      "XAIProvider is not implemented. Use provider: gemini.",
    );
  }
}

export const byokHintForProvider = (name: string): string => {
  switch (name) {
    case "gemini":
      return "BYOK: set GEMINI_API_KEY in your environment (never commit keys).";
    default:
      return `BYOK: provider "${name}" is not available. Use gemini with GEMINI_API_KEY.`;
  }
};

export const createProvider = (
  name: string,
  options: ProviderOptions = {},
): LLMProvider => {
  switch (name) {
    case "gemini":
      return new GeminiProvider(options as GeminiProviderOptions);
    case "anthropic":
      return new AnthropicProvider();
    case "xai":
      return new XAIProvider();
    case "openai":
      throw new Error(
        "OpenAI is not supported. Configure provider: gemini and set GEMINI_API_KEY.",
      );
    default:
      throw new Error(
        `Unknown LLM provider: ${name}. Supported: gemini.`,
      );
  }
};
