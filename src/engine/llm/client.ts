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
   */
  reasoning?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
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
      signal: AbortSignal.timeout(this.config.timeout!),
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
      signal: AbortSignal.timeout(this.config.timeout!),
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
      signal: AbortSignal.timeout(this.config.timeout!),
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
  }): Promise<{ content: string; tokensUsed: number }> {
    const response = await this.chat({
      model: options?.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });

    const choice = response.choices[0];
    const message = choice?.message;
    const content = message?.content || '';
    const reasoning = message?.reasoning || '';
    const finishReason = choice?.finish_reason;

    // Reasoning-model safety net: empty content + present reasoning + truncated
    // output almost always means the budget was too small. Log once per client
    // so the user can see it and bump maxTokens (or upgrade the capability
    // table entry to flag the model as reasoning).
    if (!content && reasoning && finishReason === 'length' && !this.warnedReasoningTruncation) {
      this.warnedReasoningTruncation = true;
      process.stderr.write(
        `[clarifyprompt] Model '${response.model}' returned reasoning but hit the token limit before producing content. ` +
        `This usually means the model is a chain-of-thought reasoner running on a budget that's too small. ` +
        `Try raising max_tokens, or flag the model as 'reasoningChainOfThought: true' in src/engine/context/targetModelSignals.ts.\n`,
      );
    }

    return {
      content,
      tokensUsed: response.usage?.total_tokens || 0,
    };
  }

  private warnedReasoningTruncation = false;
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
