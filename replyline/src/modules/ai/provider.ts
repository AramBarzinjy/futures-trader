import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import type { AiTaskInput } from "./prompts";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { mockGenerate } from "./mock";

/*
 * AI provider abstraction.
 * - mock:      deterministic drafts built only from stored data. No data leaves the server.
 * - anthropic: Claude via the official SDK, with structured outputs so the
 *              response always matches a Zod schema (and is re-validated here).
 */

export interface AiProvider {
  readonly name: string;
  /** True when enquiry text is sent to a third party. */
  readonly external: boolean;
  generate<S extends z.ZodType>(input: AiTaskInput, schema: S): Promise<z.infer<S>>;
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  readonly external = false;
  async generate<S extends z.ZodType>(input: AiTaskInput, schema: S): Promise<z.infer<S>> {
    return schema.parse(mockGenerate(input));
  }
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic";
  readonly external = true;
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async generate<S extends z.ZodType>(input: AiTaskInput, schema: S): Promise<z.infer<S>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4000,
        // If a safety classifier declines, the API retries on a suitable model within the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
        system: buildSystemPrompt(input),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AiProviderError("The AI service is busy. Try again in a minute.");
      if (e instanceof Anthropic.AuthenticationError) throw new AiProviderError("The AI service isn't configured correctly (check ANTHROPIC_API_KEY).");
      if (e instanceof Anthropic.APIError) throw new AiProviderError(`The AI service returned an error (${e.status ?? "network"}).`);
      throw e;
    }
    if (response.stop_reason === "refusal") throw new AiProviderError("The AI declined this request. Write this reply manually.");
    if (response.stop_reason === "max_tokens") throw new AiProviderError("The AI response was cut off. Try again.");
    // Re-validate: never trust the shape of model output, even with structured outputs.
    const parsed = schema.safeParse(response.parsed_output);
    if (!parsed.success) throw new AiProviderError("The AI returned something unexpected. Try again.");
    return parsed.data;
  }
}

let override: AiProvider | null = null;
export function setAiProviderForTests(p: AiProvider | null) {
  override = p;
}

export function getAiProvider(): AiProvider {
  if (override) return override;
  const e = env();
  if (e.AI_PROVIDER === "anthropic") {
    if (!e.ANTHROPIC_API_KEY) throw new AiProviderError("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    return new AnthropicAiProvider(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL);
  }
  return new MockAiProvider();
}
