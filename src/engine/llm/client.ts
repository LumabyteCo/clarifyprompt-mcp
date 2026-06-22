import {
  isThinkingModel,
  isThinkingByName,
  characterizeThinking,
  observeResponse,
} from './model-capabilities.js';

export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  timeout?: number;
  /**
   * Default `reasoning_effort` applied to detected reasoning models (see
   * isReasoningModel). Defaults to 'low' — the level that reliably keeps gpt-oss
   * from spending its whole budget in the thinking channel. From LLM_REASONING_EFFORT.
   */
  reasoningEffort?: ReasoningEffort;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * Some OpenAI-compatible endpoints (notably Ollama Cloud for reasoning
   * models like gpt-oss, kimi-thinking, deepseek-r, and the OpenAI o-series
   * itself) return the chain-of-thought separately from the final content.
   * ClarifyPrompt never returns this as the optimized prompt — it's thinking,
   * not answer — but it's useful for diagnostics when `content` is empty.
   *
   * Providers disagree on the field name. We read all three:
   *   - `reasoning`         — legacy / several OpenAI-compatible gateways
   *   - `thinking`          — Ollama (gpt-oss, qwen3-thinking, …)
   *   - `reasoning_content` — DeepSeek and some gateways
   */
  reasoning?: string;
  thinking?: string;
  reasoning_content?: string;
}

/**
 * Recover the assistant's final answer and its (optional) chain-of-thought from
 * a completion message, tolerant of the three field names providers use for the
 * thinking channel. The thinking trace is NEVER returned as content — it's
 * diagnostics only (see the gpt-oss empty-content failure mode, issue #3).
 */
export function extractAssistantContent(
  message: ChatMessage | undefined,
): { content: string; reasoning: string } {
  return {
    content: message?.content || '',
    reasoning: message?.reasoning || message?.thinking || message?.reasoning_content || '',
  };
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Floor on `max_tokens` for reasoning models. The empty-content failure (issue
 * #3) is fundamentally a budget problem: these models emit a large thinking
 * trace BEFORE the final answer, so a tight `max_tokens` is spent entirely on
 * reasoning and `content` comes back "". A generous floor guarantees room for
 * both. Verified to cover the worst observed traces (glm-5.2 ~2.6k thinking
 * tokens) with ample headroom for the final answer. It's a cap, not a target —
 * models stop at their natural end, so this adds no latency when reasoning is short.
 */
const REASONING_MIN_TOKENS = 8192;

// "Is this a thinking-channel model?" — the one that can exhaust its token
// budget on reasoning before emitting the final answer (issue #3). This is
// characterized ROBUSTLY, not from a hardcoded list: the Ollama runtime's
// reported capabilities, plus learning from actual responses, with a small name
// hint as last resort (see model-capabilities.ts). Two levers, applied together
// because families honor different ones: a `max_tokens` floor (universal — the
// only thing that works for glm) and `reasoning_effort: 'low'` (gpt-oss). The
// name-agnostic empty-content retry (simpleGenerate) is the final backstop.
//
// `isReasoningModel` is re-exported (name-based) for back-compat; internally we
// use the cache-aware `isThinkingModel`.
export const isReasoningModel = isThinkingByName;

function parseReasoningEffort(raw: string | undefined): ReasoningEffort | undefined {
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : undefined;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /**
   * Optional caller cancellation signal (1.10.0). Combined with the per-call
   * timeout so a client cancel (MCP `notifications/cancelled` → the tool
   * handler's `extra.signal`) aborts the in-flight HTTP request immediately,
   * not just on timeout. Model-agnostic: the signal reaches `fetch` regardless
   * of provider or model.
   */
  signal?: AbortSignal;
  /**
   * OpenAI `reasoning_effort` ('low' | 'medium' | 'high'). When omitted, the
   * client auto-applies its configured default to detected reasoning models
   * (see isReasoningModel) and sends nothing for everyone else.
   */
  reasoning_effort?: ReasoningEffort;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
}

const DEFAULT_CONFIG: Partial<LLMConfig> = {
  defaultModel: 'qwen2.5:7b',
  timeout: 30000,
};

export class LLMClient {
  private config: LLMConfig;
  private isAnthropic: boolean;

  constructor(config: Partial<LLMConfig> = {}) {
    const apiUrl = config.apiUrl
      || process.env.LLM_API_URL
      || process.env.OLLAMA_API_URL
      || 'http://localhost:11434/v1';

    const apiKey = config.apiKey
      || process.env.LLM_API_KEY
      || process.env.OLLAMA_API_KEY
      || '';

    const defaultModel = config.defaultModel
      || process.env.LLM_MODEL
      || DEFAULT_CONFIG.defaultModel!;

    // Allow CI / users to bump the per-call timeout for slower hosted models
    // (gpt-4o-mini occasionally takes >30s on long prompts; the default 30s
    // would surface as a timeout error rather than a real assertion failure).
    const envTimeoutMs = Number(process.env.LLM_TIMEOUT_MS);
    const envTimeoutValid = Number.isFinite(envTimeoutMs) && envTimeoutMs > 0;

    this.config = {
      apiUrl,
      apiKey,
      defaultModel,
      timeout: config.timeout || (envTimeoutValid ? envTimeoutMs : DEFAULT_CONFIG.timeout),
      reasoningEffort: config.reasoningEffort
        ?? parseReasoningEffort(process.env.LLM_REASONING_EFFORT)
        ?? 'low',
    };

    this.isAnthropic = apiUrl.includes('anthropic.com');
  }

  getModelName(): string {
    return this.config.defaultModel;
  }

  /**
   * The `reasoning_effort` to send: an explicit per-request value wins; otherwise
   * the configured default is applied ONLY to detected reasoning models, so the
   * common (non-reasoning) path stays byte-identical. Returns undefined when
   * nothing should be sent.
   */
  private resolveReasoningEffort(model: string, explicit?: ReasoningEffort): ReasoningEffort | undefined {
    if (explicit) return explicit;
    return isThinkingModel(model) ? this.config.reasoningEffort : undefined;
  }

  /** Build the OpenAI-compatible chat body, adding reasoning_effort when applicable. */
  private buildOpenAIBody(
    request: Omit<ChatCompletionRequest, 'model'> & { model?: string },
    stream: boolean,
  ): Record<string, unknown> {
    const model = request.model || this.config.defaultModel;
    const reasoning = isThinkingModel(model);
    // Floor the budget for reasoning models so the thinking trace can't starve
    // the final answer (the universal fix — works even where reasoning_effort
    // is ignored). It's a ceiling: short answers still finish early.
    let maxTokens = request.max_tokens ?? 2048;
    if (reasoning) maxTokens = Math.max(maxTokens, REASONING_MIN_TOKENS);
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream,
      temperature: request.temperature ?? 0.7,
      max_tokens: maxTokens,
    };
    const effort = this.resolveReasoningEffort(model, request.reasoning_effort);
    if (effort) body.reasoning_effort = effort;
    return body;
  }

  /**
   * Combine the per-call timeout with an optional caller cancellation signal so
   * `fetch` aborts on whichever fires first. `AbortSignal.any` is available on
   * Node ≥18.17 (our floor is >=18; CI covers 18/20/22/24).
   */
  private withTimeout(caller?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.config.timeout!);
    return caller ? AbortSignal.any([timeout, caller]) : timeout;
  }

  async chat(request: Omit<ChatCompletionRequest, 'model'> & { model?: string }): Promise<ChatCompletionResponse> {
    if (this.isAnthropic) {
      return this.chatAnthropic(request);
    }
    return this.chatOpenAI(request);
  }

  private async chatOpenAI(request: Omit<ChatCompletionRequest, 'model'> & { model?: string }): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(this.buildOpenAIBody(request, false)),
      signal: this.withTimeout(request.signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMError(
        `LLM API error: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    return await response.json() as ChatCompletionResponse;
  }

  private async chatAnthropic(request: Omit<ChatCompletionRequest, 'model'> & { model?: string }): Promise<ChatCompletionResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model || this.config.defaultModel,
      messages: nonSystemMessages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 2048,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    const response = await fetch(`${this.config.apiUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: this.withTimeout(request.signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMError(
        `LLM API error: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const anthropicResponse = await response.json() as {
      id: string;
      model: string;
      content: Array<{ type: string; text: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      id: anthropicResponse.id,
      model: anthropicResponse.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: anthropicResponse.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join(''),
        },
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : anthropicResponse.stop_reason,
      }],
      usage: {
        prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
        completion_tokens: anthropicResponse.usage?.output_tokens || 0,
        total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0),
      },
    };
  }

  async *chatStream(request: Omit<ChatCompletionRequest, 'model' | 'stream'> & { model?: string }): AsyncGenerator<StreamChunk> {
    if (this.isAnthropic) {
      throw new LLMError('Streaming is not supported for Anthropic provider. Use non-streaming chat instead.', 501, 'Not implemented');
    }

    const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(this.buildOpenAIBody(request, true)),
      signal: this.withTimeout(request.signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new LLMError(`LLM API error: ${response.status} ${response.statusText}`, response.status, errorText);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new LLMError('No response body', 500, 'Empty response');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as StreamChunk;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  async simpleGenerate(systemPrompt: string, userPrompt: string, options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    signal?: AbortSignal;
  }): Promise<{ content: string; tokensUsed: number }> {
    const model = options?.model ?? this.config.defaultModel;
    // Robustly characterize the model up front (Ollama /api/show capability probe,
    // cached) so the budget floor + reasoning_effort apply on the FIRST call —
    // avoiding an empty-then-retry double-call for thinking models we haven't met.
    // Best-effort; never throws; skipped for Anthropic (different thinking model).
    if (!this.isAnthropic) {
      await characterizeThinking(model, { apiUrl: this.config.apiUrl, apiKey: this.config.apiKey });
    }

    const response = await this.chat({
      model: options?.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      reasoning_effort: options?.reasoningEffort,
      signal: options?.signal,
    });

    const choice = response.choices[0];
    let { content, reasoning } = extractAssistantContent(choice?.message);
    let tokensUsed = response.usage?.total_tokens || 0;
    const finishReason = choice?.finish_reason;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    // Learn from the response: a reasoning trace — or empty content with tokens
    // spent — proves a thinking channel, so future calls to this model get the
    // floor upfront even if the runtime probe and name hint both missed it.
    observeResponse(model, { content, reasoning, completionTokens });

    // Empty-content recovery (issue #3). The final answer came back empty. The
    // real root cause for reasoning models (gpt-oss especially): the model spends
    // its whole `max_tokens` budget in the thinking channel and never reaches the
    // final channel — completion_tokens hits the cap, `reasoning` is large,
    // `content` is "". (Confirmed empirically: worse at higher reasoning effort;
    // it is NOT the `/v1` shim "dropping" a final channel that was emitted.)
    //
    // The effective lever is the reasoning level, NOT a "final-answer-only"
    // instruction — gpt-oss ignores being told to stop reasoning (verified). So
    // retry ONCE forcing `reasoning_effort: 'low'` (plus a larger budget and the
    // directive, which help other providers). If it's STILL empty, THROW — the
    // engine catches it, degrades to the original prompt, and records the error,
    // so callers get a clear failure + usable text, never a silent empty string.
    if (!content) {
      if (!this.warnedReasoningEmptyContent) {
        this.warnedReasoningEmptyContent = true;
        process.stderr.write(
          `[clarifyprompt] Model '${response.model}' returned empty content ` +
          `(finish_reason=${finishReason}, completion_tokens=${completionTokens}, ` +
          `thinking_trace=${reasoning ? 'present' : 'absent'}). Retrying once at reasoning_effort=low ` +
          `with a larger token budget. If this recurs, the model is exhausting its budget in the thinking ` +
          `channel — set LLM_REASONING_EFFORT=low (default), raise max_tokens, or use a non-reasoning model.\n`,
        );
      }
      const retry = await this.chat({
        model: options?.model,
        messages: [
          {
            role: 'system',
            content: `${systemPrompt}\n\nIMPORTANT: Respond with ONLY the final result. Do not include any reasoning, analysis, planning, or <think> blocks in your reply.`,
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: options?.temperature,
        max_tokens: Math.max(options?.maxTokens ?? 0, 16384),
        reasoning_effort: 'low', // the lever that actually keeps gpt-oss from starving the final channel
        signal: options?.signal,
      });
      const recovered = extractAssistantContent(retry.choices[0]?.message);
      if (recovered.content) {
        content = recovered.content;
        tokensUsed += retry.usage?.total_tokens || 0;
      } else {
        const retryCompletion = retry.usage?.completion_tokens ?? 0;
        throw new LLMError(
          `Model '${response.model}' returned empty content even after a reasoning_effort=low retry ` +
          `(generated ${completionTokens}+${retryCompletion} thinking token(s) but no final answer). The ` +
          `model is exhausting its token budget in the thinking channel — set LLM_REASONING_EFFORT=low, ` +
          `raise max_tokens, or use a non-reasoning model.`,
          502,
          reasoning.slice(0, 500),
        );
      }
    }

    return { content, tokensUsed };
  }

  private warnedReasoningEmptyContent = false;
}

export class LLMError extends Error {
  constructor(message: string, public statusCode: number, public details: string) {
    super(message);
    this.name = 'LLMError';
  }
}

let clientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!clientInstance) {
    clientInstance = new LLMClient();
  }
  return clientInstance;
}
