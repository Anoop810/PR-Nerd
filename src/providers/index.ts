import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import type {
  ChatRequest,
  ChatResponse,
  LLMMessage,
  LLMProvider,
} from "./types.js";
import { toOpenAITools } from "./types.js";

export type { LLMProvider, ChatRequest, ChatResponse, LLMMessage } from "./types.js";

const ENV_KEYS = ["OPENAI_API_KEY", "PRNERD_OPENAI_API_KEY"] as const;

export const resolveOpenAIApiKey = (
  explicit?: string,
): string | undefined => {
  if (explicit?.trim()) return explicit.trim();
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }
  return undefined;
};

const toOpenAIMessages = (
  messages: LLMMessage[],
): ChatCompletionMessageParam[] =>
  messages.map((message) => {
    if (message.role === "tool") {
      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content ?? "",
      };
      return toolMsg;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        })),
      };
    }
    if (message.role === "system") {
      return { role: "system" as const, content: message.content ?? "" };
    }
    if (message.role === "user") {
      return { role: "user" as const, content: message.content ?? "" };
    }
    return { role: "assistant" as const, content: message.content };
  });

export type OpenAIProviderOptions = {
  apiKey?: string;
  baseURL?: string;
};

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = resolveOpenAIApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not found. Set OPENAI_API_KEY (BYOK) or pass apiKey.",
      );
    }
    this.client = new OpenAI({
      apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: toOpenAIMessages(request.messages),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens,
      ...(request.tools?.length
        ? { tools: toOpenAITools(request.tools) }
        : {}),
    });

    const choice = response.choices[0];
    const message = choice?.message;

    return {
      content: message?.content ?? null,
      toolCalls:
        message?.tool_calls?.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })) ?? [],
      finishReason: choice?.finish_reason ?? null,
      raw: response,
    };
  }
}

/**
 * Stubs for future providers — keep the abstraction stable.
 * These throw until implemented so misconfiguration fails loudly.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      "AnthropicProvider is not implemented in V1. Use provider: openai.",
    );
  }
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      "GeminiProvider is not implemented in V1. Use provider: openai.",
    );
  }
}

export class XAIProvider implements LLMProvider {
  readonly name = "xai";
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      "XAIProvider is not implemented in V1. Use provider: openai.",
    );
  }
}

export const createProvider = (
  name: string,
  options: OpenAIProviderOptions = {},
): LLMProvider => {
  switch (name) {
    case "openai":
      return new OpenAIProvider(options);
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "xai":
      return new XAIProvider();
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
};
