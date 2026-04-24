/**
 * Pluggable embedder. Same shape as the LLM client: OpenAI-compatible
 * endpoint by default, with an optional Anthropic bypass if anyone ever
 * asks (Anthropic doesn't publish an embeddings API today, so for now the
 * interface is strictly OpenAI-compatible).
 *
 * Defaults assume the user's local Ollama has nomic-embed-text, which
 * produces 768-dim vectors matching the vec0 table declared in migration 1.
 */

export interface Embedder {
  /** Human-readable model ID for logging / trace. */
  readonly modelName: string;
  /** Embedding dimension the model produces. */
  readonly dimension: number;
  /** Embed one string; returns a Float32Array of length `dimension`. */
  embed(text: string): Promise<Float32Array>;
  /** Embed a batch; should be at least as efficient as N serial calls. */
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export interface EmbedderConfig {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  dimension?: number;
  timeout?: number;
}

export class OpenAICompatibleEmbedder implements Embedder {
  readonly modelName: string;
  readonly dimension: number;
  private apiUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: EmbedderConfig = {}) {
    this.apiUrl =
      config.apiUrl ||
      process.env.EMBED_API_URL ||
      process.env.LLM_API_URL ||   // fallback: same endpoint as the LLM
      'http://localhost:11434/v1';
    this.apiKey =
      config.apiKey ||
      process.env.EMBED_API_KEY ||
      process.env.LLM_API_KEY ||
      '';
    this.modelName =
      config.model ||
      process.env.EMBED_MODEL ||
      'nomic-embed-text:v1.5';
    this.dimension =
      config.dimension ||
      Number(process.env.EMBED_DIMENSION || 768);
    this.timeout = config.timeout || 30_000;
  }

  async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];

    const response = await fetch(`${this.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new EmbedderError(
        `Embedding API error: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (!data.data || !Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new EmbedderError(
        `Embedder returned ${data.data?.length ?? 0} vectors for ${texts.length} inputs`,
        500,
      );
    }

    return data.data.map(d => Float32Array.from(d.embedding));
  }
}

export class EmbedderError extends Error {
  constructor(message: string, public statusCode: number, public details?: string) {
    super(message);
    this.name = 'EmbedderError';
  }
}

/** Serialize a Float32Array for sqlite-vec's vec_f32() SQL function. */
export function vecToJson(v: Float32Array): string {
  return JSON.stringify(Array.from(v));
}

let _singleton: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (!_singleton) _singleton = new OpenAICompatibleEmbedder();
  return _singleton;
}

/** Test-only: reset the cached embedder (forces env re-read on next getEmbedder()). */
export function resetEmbedder(): void {
  _singleton = null;
}
