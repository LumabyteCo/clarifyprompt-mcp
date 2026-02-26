export type SearchProvider = 'tavily' | 'brave' | 'serper' | 'serpapi' | 'exa' | 'searxng';

export interface SearchConfig {
  provider: SearchProvider;
  apiKey: string;
  apiUrl?: string; // Only needed for SearXNG (self-hosted)
  timeout?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
}

export class SearchClient {
  private config: SearchConfig;

  constructor(config?: Partial<SearchConfig>) {
    this.config = {
      provider: (config?.provider || process.env.SEARCH_PROVIDER || 'tavily') as SearchProvider,
      apiKey: config?.apiKey || process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY || '',
      apiUrl: config?.apiUrl || process.env.SEARCH_API_URL,
      timeout: config?.timeout || 10000,
    };
  }

  async search(query: string, maxResults = 5): Promise<SearchResponse> {
    if (!this.config.apiKey && this.config.provider !== 'searxng') {
      throw new SearchError(`${this.config.provider} API key not configured`, 401);
    }

    switch (this.config.provider) {
      case 'tavily': return this.searchTavily(query, maxResults);
      case 'brave': return this.searchBrave(query, maxResults);
      case 'serper': return this.searchSerper(query, maxResults);
      case 'serpapi': return this.searchSerpAPI(query, maxResults);
      case 'exa': return this.searchExa(query, maxResults);
      case 'searxng': return this.searchSearXNG(query, maxResults);
      default:
        throw new SearchError(`Unknown search provider: ${this.config.provider}`, 400);
    }
  }

  async enrichContext(prompt: string): Promise<{ enriched: boolean; context: string; sources: string[] }> {
    try {
      const searchQuery = this.extractSearchQuery(prompt);
      if (!searchQuery) return { enriched: false, context: '', sources: [] };

      const searchResults = await this.search(searchQuery, 3);
      const contextParts: string[] = [];
      const sources: string[] = [];

      if (searchResults.answer) contextParts.push(`Summary: ${searchResults.answer}`);
      for (const result of searchResults.results.slice(0, 3)) {
        contextParts.push(`- ${result.title}: ${result.content.slice(0, 200)}...`);
        sources.push(result.url);
      }

      return { enriched: true, context: contextParts.join('\n\n'), sources };
    } catch {
      return { enriched: false, context: '', sources: [] };
    }
  }

  // --- Provider implementations ---

  private async searchTavily(query: string, maxResults: number): Promise<SearchResponse> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        query,
        search_depth: 'basic',
        include_answer: true,
        include_images: false,
        include_raw_content: false,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`Tavily API error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      query: string;
      answer?: string;
      results: Array<{ title: string; url: string; content: string; score: number }>;
    };

    return {
      query: data.query,
      answer: data.answer,
      results: data.results.map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
    };
  }

  private async searchBrave(query: string, maxResults: number): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query, count: String(maxResults) });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.config.apiKey,
      },
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`Brave Search API error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      query: { original: string };
      web?: { results: Array<{ title: string; url: string; description: string }> };
    };

    return {
      query: data.query.original,
      results: (data.web?.results || []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.description,
      })),
    };
  }

  private async searchSerper(query: string, maxResults: number): Promise<SearchResponse> {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.config.apiKey,
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`Serper API error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      searchParameters: { q: string };
      answerBox?: { answer?: string; snippet?: string };
      organic: Array<{ title: string; link: string; snippet: string }>;
    };

    return {
      query: data.searchParameters.q,
      answer: data.answerBox?.answer || data.answerBox?.snippet,
      results: (data.organic || []).map(r => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
      })),
    };
  }

  private async searchSerpAPI(query: string, maxResults: number): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query,
      api_key: this.config.apiKey,
      engine: 'google',
      num: String(maxResults),
    });
    const response = await fetch(`https://serpapi.com/search?${params}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`SerpAPI error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      search_parameters: { q: string };
      answer_box?: { answer?: string; snippet?: string };
      organic_results: Array<{ title: string; link: string; snippet: string }>;
    };

    return {
      query: data.search_parameters.q,
      answer: data.answer_box?.answer || data.answer_box?.snippet,
      results: (data.organic_results || []).map(r => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
      })),
    };
  }

  private async searchExa(query: string, maxResults: number): Promise<SearchResponse> {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'neural',
        numResults: maxResults,
        contents: { text: { maxCharacters: 500 } },
      }),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`Exa API error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      results: Array<{ title: string; url: string; text?: string; score: number }>;
    };

    return {
      query,
      results: (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.text || '',
        score: r.score,
      })),
    };
  }

  private async searchSearXNG(query: string, maxResults: number): Promise<SearchResponse> {
    const baseUrl = this.config.apiUrl;
    if (!baseUrl) {
      throw new SearchError('SEARCH_API_URL is required for SearXNG (your self-hosted instance URL)', 400);
    }

    const params = new URLSearchParams({ q: query, format: 'json', pageno: '1' });
    const response = await fetch(`${baseUrl}/search?${params}`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SearchError(`SearXNG error: ${response.status}`, response.status, errorText);
    }

    const data = await response.json() as {
      query: string;
      results: Array<{ title: string; url: string; content: string }>;
    };

    return {
      query: data.query,
      results: (data.results || []).slice(0, maxResults).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
  }

  // --- Utilities ---

  private extractSearchQuery(prompt: string): string {
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
      'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
      'by', 'from', 'as', 'into', 'through', 'during', 'before',
      'after', 'above', 'below', 'between', 'under', 'again',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
      'she', 'her', 'it', 'its', 'they', 'them', 'their',
      'what', 'which', 'who', 'this', 'that', 'these', 'those',
      'am', 'about', 'and', 'but', 'if', 'or', 'because', 'until',
      'while', 'please', 'help', 'write', 'create', 'make', 'give',
      'tell', 'explain', 'describe',
    ]);

    const words = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    const keywords = words.slice(0, 8).join(' ');
    return keywords.length < 10 ? '' : keywords;
  }
}

export class SearchError extends Error {
  constructor(message: string, public statusCode: number, public details?: string) {
    super(message);
    this.name = 'SearchError';
  }
}

let clientInstance: SearchClient | null = null;

export function getSearchClient(): SearchClient {
  if (!clientInstance) clientInstance = new SearchClient();
  return clientInstance;
}
