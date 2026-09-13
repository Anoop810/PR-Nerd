export type LLMRole = "system" | "user" | "assistant" | "tool";

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMMessage = {
  role: LLMRole;
  content: string | null;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCallRequest[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  model: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse = {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string | null;
  raw?: unknown;
};

/**
 * Provider-agnostic LLM interface.
 * Implementations must never log or persist API keys.
 */
export interface LLMProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
