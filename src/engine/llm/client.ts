export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel: string;
  timeout?: number;
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
    };

    this.isAnthropic = apiUrl.includes('anthropic.com');
  }

  getModelName(): string {
    return this.config.defaultModel;
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
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: request.messages,
        stream: false,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens ?? 2048,
      }),
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
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: request.messages,
        stream: true,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens ?? 2048,
      }),
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
    signal?: AbortSignal;
  }): Promise<{ content: string; tokensUsed: number }> {
    const response = await this.chat({
      model: options?.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      signal: options?.signal,
    });

    const choice = response.choices[0];
    let { content, reasoning } = extractAssistantContent(choice?.message);
    let tokensUsed = response.usage?.total_tokens || 0;
    const finishReason = choice?.finish_reason;
    const completionTokens = response.usage?.completion_tokens ?? 0;

    // Empty-content recovery (issue #3). The final answer came back empty. Three
    // real causes seen in the wild — handled uniformly because the user-facing
    // harm (a silent empty optimized prompt) is identical:
    //   (a) the model routed everything through a thinking channel
    //       (`reasoning` / `thinking` / `reasoning_content`) and emitted no final
    //       answer — recoverable by re-asking for the final answer only;
    //   (b) it exhausted the token budget mid-thought (finish_reason='length');
    //   (c) it generated tokens the OpenAI-compatible endpoint never surfaced as
    //       `content` at all — gpt-oss harmony format over Ollama's /v1 shim:
    //       completion_tokens>0, content=='', and NO thinking field populated.
    // Retry ONCE with a final-answer-only directive + a larger budget. If the
    // answer is still empty, THROW — the engine catches it, degrades to the
    // original prompt, and records the error in the trace, so callers get a
    // clear failure + usable text instead of a silent empty string.
    if (!content) {
      if (!this.warnedReasoningEmptyContent) {
        this.warnedReasoningEmptyContent = true;
        process.stderr.write(
          `[clarifyprompt] Model '${response.model}' returned empty content ` +
          `(finish_reason=${finishReason}, completion_tokens=${completionTokens}, ` +
          `thinking_trace=${reasoning ? 'present' : 'absent'}). Retrying once with a final-answer-only ` +
          `directive and a larger token budget. If this recurs with completion_tokens>0, the model's ` +
          `output channel isn't being surfaced by this OpenAI-compatible endpoint (common with gpt-oss ` +
          `harmony format via Ollama's /v1 shim) — try a non-reasoning model or Ollama's native /api/chat.\n`,
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
        signal: options?.signal,
      });
      const recovered = extractAssistantContent(retry.choices[0]?.message);
      if (recovered.content) {
        content = recovered.content;
        tokensUsed += retry.usage?.total_tokens || 0;
      } else {
        const retryCompletion = retry.usage?.completion_tokens ?? 0;
        throw new LLMError(
          `Model '${response.model}' returned empty content even after a final-answer-only retry ` +
          `(generated ${completionTokens}+${retryCompletion} token(s) the endpoint did not surface as ` +
          `content). This is common with gpt-oss harmony output over Ollama's OpenAI-compatible /v1 ` +
          `endpoint. Try a non-reasoning model, Ollama's native /api/chat, or raise max_tokens.`,
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
