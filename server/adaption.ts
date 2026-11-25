import type { TaskResponse } from './types.ts';
import {
  buildProtectedTestGuardPrompt,
  buildRepoContextExcerpt,
  filterProtectedPriorityPaths,
  normalizeProtectedTestFiles,
} from './providerUtils.ts';

const DEFAULT_ADAPTION_BASE_URL = 'https://api.prod.adaptionlabs.ai/api/v1';

export const DEFAULT_ADAPTION_QWEN_MODEL = 'adaption/qwen3.5-397b';
export const DEFAULT_ADAPTION_LONG_CONTEXT_QWEN_MODEL = 'adaption/qwen-SEA-LION-v5-397b-a17b-plus';

export function isAdaptionConfigured(): boolean {
  return Boolean(process.env.ADAPTION_API_KEY?.trim());
}

export function getAdaptionChatCompletionsUrl(): string {
  const base = (process.env.ADAPTION_BASE_URL?.trim() || DEFAULT_ADAPTION_BASE_URL).replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) {
    return base;
  }
  return `${base}/chat/completions`;
}

export function normalizeAdaptionModelId(modelIdentifier: string): string {
  return modelIdentifier.trim().replace(/^adaption\//i, '');
}

function stripReasoningBlocks(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Handle unclosed <think> if model spent tokens thinking before emitting JSON
  if (/<think>/i.test(text)) {
    const thinkStart = text.search(/<think>/i);
    const afterThink = text.slice(thinkStart);
    const jsonHint = afterThink.search(/\{\s*"(?:summary|files)"/);
    if (jsonHint >= 0) {
      text = afterThink.slice(jsonHint).trim();
    }
  }
  return text;
}

function extractAllJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  // 1. Prefer explicitly tagged ```json ... ``` fenced blocks
  const jsonFences = text.matchAll(/```json\s*([\s\S]*?)```/gi);
  for (const match of jsonFences) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  // 2. Any generic fenced block that looks like a JSON object
  const anyFences = text.matchAll(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g);
  for (const match of anyFences) {
    const inner = match[1]?.trim() || '';
    if (inner.startsWith('{') && inner.endsWith('}')) {
      candidates.push(inner);
    }
  }

  // 3. Balanced outermost JSON object scan (try every top-level '{' that contains "files")
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf('{', searchFrom);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let foundEnd = -1;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          foundEnd = i;
          break;
        }
      }
    }

    if (foundEnd > start) {
      candidates.push(text.slice(start, foundEnd + 1));
      searchFrom = foundEnd + 1;
    } else {
      break;
    }
  }

  // 4. Raw trimmed text + widest brace slice as final candidates
  candidates.push(text.trim());
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  // Prioritize candidates containing "files"
  return candidates.sort((a, b) => {
    const aHas = /"files"\s*:/.test(a) ? 0 : 1;
    const bHas = /"files"\s*:/.test(b) ? 0 : 1;
    return aHas - bHas;
  });
}

function escapeControlCharsInsideJsonStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out;
}

function parseAgentJson(
  raw: string,
  meta?: { finishReason?: string | null; outputTokens?: number }
): {
  summary: string;
  files: Array<{ path: string; operation: string; code: string }>;
} {
  const stripped = stripReasoningBlocks(raw);
  if (!stripped) {
    const detail =
      meta?.finishReason === 'length'
        ? `Adaption AI exhausted output tokens (${meta.outputTokens ?? 0}) during reasoning before producing JSON.`
        : 'Adaption AI returned an empty response.';
    throw Object.assign(new Error(detail), { statusCode: 502 });
  }

  const coerce = (parsed: unknown) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Response is not a JSON object.');
    }
    const obj = parsed as { summary?: unknown; files?: unknown };
    const rawFiles = Array.isArray(obj.files) ? obj.files : [];
    const files = rawFiles
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
      .map((f) => ({
        path: String(f.path || f.file_path || f.filename || '').trim(),
        operation: String(f.operation || f.status || 'modify').trim().toLowerCase(),
        code: typeof f.code === 'string' ? f.code : typeof f.content === 'string' ? f.content : '',
      }))
      .filter((f) => f.path.length > 0);

    return {
      summary:
        typeof obj.summary === 'string' && obj.summary.trim()
          ? obj.summary.trim()
          : 'Adaption AI Qwen agent trial completed.',
      files,
    };
  };

  const candidates = extractAllJsonCandidates(stripped);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const coerced = coerce(JSON.parse(candidate));
      if (coerced.files.length > 0 || /"files"\s*:/.test(candidate)) {
        return coerced;
      }
    } catch {
      // Retry with control-char repair inside string literals + trailing comma removal
      try {
        const repaired = escapeControlCharsInsideJsonStrings(candidate).replace(/,\s*([}\]])/g, '$1');
        const coerced = coerce(JSON.parse(repaired));
        if (coerced.files.length > 0 || /"files"\s*:/.test(repaired)) {
          return coerced;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  const reasonNote =
    meta?.finishReason === 'length'
      ? ` (truncated at finish_reason=length after ${meta.outputTokens ?? 0} output tokens)`
      : meta?.finishReason
        ? ` (finish_reason=${meta.finishReason}, ${meta.outputTokens ?? 0} output tokens)`
        : '';

  throw Object.assign(
    new Error(`Adaption AI returned content that could not be parsed as JSON${reasonNote}.`),
    { statusCode: 502 }
  );
}

function parseRetryDelayMs(message: string, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(15000, Math.ceil(secs * 1000) + 400);
    }
  }
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (match) {
    const val = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (Number.isFinite(val) && val > 0) {
      const ms = unit === 'ms' ? val : val * 1000;
      return Math.min(15000, Math.ceil(ms) + 500);
    }
  }
  return 2500;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface AdaptionChatResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  detail?: string;
}

function extractMessageText(message?: {
  content?: string | Array<{ type?: string; text?: string }> | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
}): string {
  if (!message) return '';
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const joined = message.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  return message.reasoning_content || message.reasoning || '';
}

export async function runLiveAdaptionAgentAttempt(params: {
  modelIdentifier: string;
  task: TaskResponse;
  files: Record<string, string>;
  protectedTestFiles?: string[];
}): Promise<{
  submittedFiles: Array<{ path: string; operation: string; code: string }>;
  inputTokens: number;
  outputTokens: number;
  summary: string;
  resolvedModel: string;
}> {
  const apiKey = process.env.ADAPTION_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error('ADAPTION_API_KEY is not configured on the server. Add it in Settings > Secrets to run Adaption Qwen models.'),
      { statusCode: 503 }
    );
  }

  const adaptionModel = normalizeAdaptionModelId(params.modelIdentifier);
  const endpointUrl = getAdaptionChatCompletionsUrl();

  const normalizedProtected = normalizeProtectedTestFiles(params.protectedTestFiles);
  const safePriorityFiles = filterProtectedPriorityPaths(params.task.relevant_files, normalizedProtected);

  const contextText = buildRepoContextExcerpt({
    files: params.files,
    maxBytes: 28000,
    priorityPaths: safePriorityFiles,
    priorityFileCap: 16000,
    supportingFileCap: 2500,
  });

  const protectedGuardBlock = buildProtectedTestGuardPrompt(normalizedProtected, 40);

  const userPrompt = `Solve this coding task against the repository files below.
Keep reasoning concise and return ONLY a single valid JSON object (no markdown fences or commentary outside JSON) with this exact structure:
{"summary":"1-2 sentence summary of edits","files":[{"path":"relative/file/path","operation":"modify","code":"complete updated file contents"}]}
Edit only the minimal necessary production source files (prefer 1-2 targeted files) with clean, complete code. Preserve all existing functions, classes, and routes.
${protectedGuardBlock}
Task: ${params.task.title}
Description: ${params.task.description}
Requirements:
${params.task.requirements.slice(0, 8).map((r, i) => `${i + 1}. ${r}`).join('\n')}
Acceptance Criteria:
${params.task.acceptance_criteria.slice(0, 8).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Relevant Repository Files:
${contextText}`;

  const body: Record<string, unknown> = {
    model: adaptionModel,
    messages: [
      {
        role: 'system',
        content:
          'You are an autonomous software engineering agent solving a Harbor coding benchmark task. Keep thinking brief and output strictly valid RFC 8259 JSON with keys "summary" (string) and "files" (non-empty array of objects with "path", "operation" in ["modify","create","delete"], and "code" containing the updated production file text). NEVER include any protected original test file path in "files". Properly escape all newlines (\\n) and double quotes (\\") inside JSON strings.',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    temperature: 0.2,
    // Generous budget for Qwen 3.5 397B reasoning + full updated file JSON without mid-JSON truncation
    max_tokens: 12288,
    response_format: { type: 'json_object' },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });

      const rawText = await response.text();
      let payload: AdaptionChatResponse | null = null;
      try {
        payload = JSON.parse(rawText) as AdaptionChatResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.detail ||
          `Adaption AI request failed with HTTP ${response.status}.`;
        // Graceful fallback if Adaption rejects response_format or max_tokens
        if (response.status === 400 && /response_format|json_object/i.test(message) && 'response_format' in body) {
          delete body.response_format;
          continue;
        }
        if (response.status === 400 && /max_tokens/i.test(message) && 'max_tokens' in body) {
          const cap = body.max_tokens;
          delete body.max_tokens;
          body.max_completion_tokens = cap;
          continue;
        }
        const retryable = response.status === 429 || response.status >= 500;
        lastError = Object.assign(new Error(message), { statusCode: response.status });
        if (retryable && attempt < 2) {
          const delayMs = parseRetryDelayMs(message, response.headers.get('retry-after'));
          await sleep(delayMs);
          continue;
        }
        throw lastError;
      }

      const choice = payload?.choices?.[0];
      const content = extractMessageText(choice?.message);
      const outputTokens = payload?.usage?.completion_tokens ?? 0;
      const parsed = parseAgentJson(content, {
        finishReason: choice?.finish_reason ?? null,
        outputTokens,
      });

      return {
        submittedFiles: parsed.files,
        inputTokens: payload?.usage?.prompt_tokens ?? 0,
        outputTokens,
        summary: parsed.summary,
        resolvedModel: `adaption/${payload?.model || adaptionModel}`,
      };
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode || 502;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        status === 429 ||
        status >= 500 ||
        /not be parsed as JSON|exhausted output tokens|empty response/i.test(msg);
      lastError = err instanceof Error ? err : new Error(msg);
      if (retryable && attempt < 2) {
        // On JSON parse / length truncation retry, drop response_format if it caused issues and tighten scope
        if (/finish_reason=length|exhausted output tokens/i.test(msg)) {
          body.max_tokens = 16384;
        }
        const delayMs = status === 429 ? parseRetryDelayMs(msg, null) : 1500;
        await sleep(delayMs);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || Object.assign(new Error('Adaption AI request failed.'), { statusCode: 502 });
}
