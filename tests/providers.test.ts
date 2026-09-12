import { describe, expect, it } from "vitest";
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
} from "../src/providers/types.js";
import {
  AnthropicProvider,
  createProvider,
  resolveOpenAIApiKey,
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
  it("createProvider returns openai implementation when key present", () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    try {
      const provider = createProvider("openai");
      expect(provider.name).toBe("openai");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it("createProvider stubs other providers without changing agent engine", async () => {
    const anthropic = createProvider("anthropic");
    expect(anthropic.name).toBe("anthropic");
    await expect(
      anthropic.chat({ model: "x", messages: [] }),
    ).rejects.toThrow(/not implemented/i);
    await expect(
      new AnthropicProvider().chat({ model: "x", messages: [] }),
    ).rejects.toThrow(/not implemented/i);
  });

  it("resolveOpenAIApiKey prefers explicit key", () => {
    expect(resolveOpenAIApiKey(" sk-explicit ")).toBe("sk-explicit");
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
