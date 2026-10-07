// Minimal Gemini REST client (no SDK dependency) for Supabase Edge Functions (Deno).
// Supports: text + audio multimodal generateContent, strict JSON output via responseSchema,
// function calling, embeddings, retries with exponential backoff.

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiInlineData {
  mimeType: string;
  data: string; // base64
}
export interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thought?: boolean;
}
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // OpenAPI-style schema subset
}

export interface GenerateOptions {
  model?: string;
  contents: GeminiContent[];
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>; // enables application/json
  tools?: FunctionDeclaration[];
  toolMode?: "AUTO" | "ANY" | "NONE";
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number; // 0 disables thinking on models that support it
}

export interface GenerateResult {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  parts: GeminiPart[];
  finishReason?: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

export class GeminiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  embeddingModel: string;
  embeddingDimensions: number;
  maxRetries?: number;
}

export function geminiConfigFromEnv(env: (k: string) => string | undefined): GeminiConfig {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return {
    apiKey,
    model: env("GEMINI_MODEL") ?? "gemini-3.5-flash",
    embeddingModel: env("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001",
    embeddingDimensions: Number(env("GEMINI_EMBEDDING_DIMENSIONS") ?? "768"),
    maxRetries: 3,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiClient {
  constructor(private cfg: GeminiConfig, private fetchImpl: typeof fetch = fetch) {}

  get model(): string {
    return this.cfg.model;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${GEMINI_BASE}/${path}`;
    const retries = this.cfg.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
          body: JSON.stringify(body),
        });
        if (res.ok) return await res.json();
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(500 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw new GeminiError(`Gemini ${res.status}: ${text.slice(0, 500)}`, res.status, text);
      } catch (e) {
        lastErr = e;
        if (e instanceof GeminiError) throw e;
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Gemini request failed");
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const model = opts.model ?? this.cfg.model;
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    };
    if (opts.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = opts.responseSchema;
    }
    if (opts.thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
    }
    const body: Record<string, unknown> = { contents: opts.contents, generationConfig };
    if (opts.systemInstruction) body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    if (opts.tools?.length) {
      body.tools = [{ functionDeclarations: opts.tools }];
      body.toolConfig = { functionCallingConfig: { mode: opts.toolMode ?? "AUTO" } };
    }
    const json = (await this.post(`models/${model}:generateContent`, body)) as Record<string, any>;
    const candidate = json.candidates?.[0];
    if (!candidate) {
      const blocked = json.promptFeedback?.blockReason;
      throw new GeminiError(blocked ? `Prompt blocked: ${blocked}` : "Gemini returned no candidates", 502, json);
    }
    const parts: GeminiPart[] = candidate.content?.parts ?? [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => ({
      name: p.functionCall!.name,
      args: (p.functionCall!.args ?? {}) as Record<string, unknown>,
    }));
    return { text, functionCalls, parts, finishReason: candidate.finishReason, usage: json.usageMetadata };
  }

  /** generateContent with a response schema, parsed as JSON. Retries once if the model returned invalid JSON. */
  async generateJSON<T>(opts: GenerateOptions): Promise<T> {
    let result = await this.generate(opts);
    try {
      return parseJSONLoose<T>(result.text);
    } catch {
      result = await this.generate({ ...opts, temperature: 0 });
      return parseJSONLoose<T>(result.text);
    }
  }

  async embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
    const json = (await this.post(`models/${this.cfg.embeddingModel}:embedContent`, {
      model: `models/${this.cfg.embeddingModel}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType,
      outputDimensionality: this.cfg.embeddingDimensions,
    })) as Record<string, any>;
    const values: number[] | undefined = json.embedding?.values;
    if (!values) throw new GeminiError("No embedding returned", 502, json);
    return normalize(values);
  }
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Tolerates ```json fences and leading prose. */
export function parseJSONLoose<T>(text: string): T {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.search(/[\[{]/);
  if (start > 0) t = t.slice(start);
  return JSON.parse(t) as T;
}
