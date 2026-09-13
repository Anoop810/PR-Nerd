import { GoogleGenAI } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type {
  ChatRequest,
  ChatResponse,
  LLMMessage,
  LLMProvider,
  ToolDefinition,
} from "./types.js";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "PRNERD_GEMINI_API_KEY",
] as const;

export const resolveGeminiApiKey = (
  explicit?: string,
): string | undefined => {
  if (explicit?.trim()) return explicit.trim();
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }
  return undefined;
};

export type GeminiProviderOptions = {
  apiKey?: string;
};

const toFunctionDeclarations = (
  tools: ToolDefinition[],
): FunctionDeclaration[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }));

const parseArgsObject = (
  raw: string | undefined,
): Record<string, unknown> => {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
};

/**
 * Convert provider-agnostic messages into Gemini contents + system instruction.
 * Exported for unit tests.
 */
export const toGeminiRequestParts = (
  messages: LLMMessage[],
): { systemInstruction: string | undefined; contents: Content[] } => {
  const systemChunks: string[] = [];
  const contents: Content[] = [];
  let pendingToolParts: Part[] = [];

  const flushToolParts = () => {
    if (pendingToolParts.length === 0) return;
    contents.push({ role: "user", parts: pendingToolParts });
    pendingToolParts = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content?.trim()) systemChunks.push(message.content);
      continue;
    }

    if (message.role === "tool") {
      pendingToolParts.push({
        functionResponse: {
          id: message.toolCallId,
          name: message.name ?? "tool",
          response: { output: message.content ?? "" },
        },
      });
      continue;
    }

    flushToolParts();

    if (message.role === "user") {
      contents.push({
        role: "user",
        parts: [{ text: message.content ?? "" }],
      });
      continue;
    }

    // assistant
    const parts: Part[] = [];
    if (message.content?.trim()) {
      parts.push({ text: message.content });
    }
    if (message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: {
            id: call.id,
            name: call.name,
            args: parseArgsObject(call.arguments),
          },
        });
      }
    }
    contents.push({
      role: "model",
      parts: parts.length > 0 ? parts : [{ text: "" }],
    });
  }

  flushToolParts();

  return {
    systemInstruction: systemChunks.length
      ? systemChunks.join("\n\n")
      : undefined,
    contents,
  };
};

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = resolveGeminiApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error(
        "Gemini API key not found. Set GEMINI_API_KEY (BYOK) or pass apiKey.",
      );
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { systemInstruction, contents } = toGeminiRequestParts(
      request.messages,
    );

    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Begin the review." }] });
    }

    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: {
        temperature: request.temperature ?? 0.1,
        maxOutputTokens: request.maxTokens,
        ...(systemInstruction ? { systemInstruction } : {}),
        automaticFunctionCalling: { disable: true },
        ...(request.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: toFunctionDeclarations(request.tools),
                },
              ],
            }
          : {}),
      },
    });

    const text = response.text?.trim() ? response.text : null;
    const functionCalls = response.functionCalls ?? [];

    const toolCalls = functionCalls.map((call, index) => ({
      id: call.id ?? `gemini_call_${index}`,
      name: call.name ?? "unknown",
      arguments: JSON.stringify(call.args ?? {}),
    }));

    const finishReason =
      response.candidates?.[0]?.finishReason?.toString() ?? null;

    return {
      content: text,
      toolCalls,
      finishReason,
      raw: response,
    };
  }
}
