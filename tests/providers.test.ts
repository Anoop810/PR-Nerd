import { describe, expect, it } from "vitest";
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "../src/providers/types.js";
import {
  AnthropicProvider,
  createProvider,
  resolveGeminiApiKey,
  toGeminiRequestParts,
} from "../src/providers/index.js";

class MockProvider implements LLMProvider {
  readonly name = "mock";
  public calls = 0;
  constructor(private readonly responses: ChatResponse[]) {}
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    const response = this.responses[this.calls] ?? {
      content: null,
      toolCalls: [],
      finishReason: "stop",
    };
    this.calls += 1;
    return response;
  }
}

describe("provider abstraction", () => {
  it("createProvider returns gemini implementation when key present", () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    try {
      const provider = createProvider("gemini");
      expect(provider.name).toBe("gemini");
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });

  it("rejects openai as unsupported", () => {
    expect(() => createProvider("openai")).toThrow(/not supported/i);
  });

  it("createProvider stubs unimplemented providers without changing agent engine", async () => {
    const anthropic = createProvider("anthropic");
    expect(anthropic.name).toBe("anthropic");
    await expect(
      anthropic.chat({ model: "x", messages: [] }),
    ).rejects.toThrow(/not implemented/i);
    await expect(
      new AnthropicProvider().chat({ model: "x", messages: [] }),
    ).rejects.toThrow(/not implemented/i);
  });

  it("resolveGeminiApiKey prefers explicit key", () => {
    expect(resolveGeminiApiKey(" gemini-explicit ")).toBe("gemini-explicit");
  });

  it("maps tool turns into Gemini function responses", () => {
    const { systemInstruction, contents } = toGeminiRequestParts([
      { role: "system", content: "You are a reviewer." },
      { role: "user", content: "Review this PR." },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/a.ts" }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        name: "read_file",
        content: "file contents",
      },
    ]);

    expect(systemInstruction).toContain("reviewer");
    expect(contents[0]?.role).toBe("user");
    expect(contents[1]?.role).toBe("model");
    expect(contents[1]?.parts?.[0]).toMatchObject({
      functionCall: { name: "read_file", id: "call_1" },
    });
    expect(contents[2]?.role).toBe("user");
    expect(contents[2]?.parts?.[0]).toMatchObject({
      functionResponse: {
        name: "read_file",
        id: "call_1",
        response: { output: "file contents" },
      },
    });
  });

  it("mock provider is usable as LLMProvider", async () => {
    const mock = new MockProvider([
      { content: "hi", toolCalls: [], finishReason: "stop" },
    ]);
    const res = await mock.chat({ model: "m", messages: [] });
    expect(res.content).toBe("hi");
    expect(mock.calls).toBe(1);
  });
});

export { MockProvider };
