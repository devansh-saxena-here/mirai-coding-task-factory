import type { TaskResponse } from './types.ts';
import {
  buildProtectedTestGuardPrompt,
  buildRepoContextExcerpt,
  coerceAgentSubmission,
  extractOutermostJsonObject,
  filterProtectedPriorityPaths,
  normalizeProtectedTestFiles,
  stripReasoningAndFences,
} from './providerUtils.ts';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const DEFAULT_GROQ_GPT_OSS_MODEL = 'groq/openai/gpt-oss-120b';
export const DEFAULT_GROQ_QWEN_MODEL = 'groq/qwen/qwen3.8-27b';

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function normalizeGroqModelId(modelIdentifier: string): string {
  return modelIdentifier.trim().replace(/^groq\//i, '');
}

function parseAgentJson(raw: string): {
  summary: string;
  files: Array<{ path: string; operation: string; code: string }>;
} {
  const cleaned = stripReasoningAndFences(raw);
  if (!cleaned) {
    throw Object.assign(new Error('Groq returned an empty response.'), { statusCode: 502 });
  }

  try {
    return coerceAgentSubmission(JSON.parse(cleaned), 'Groq agent trial completed.');
  } catch {
    const extracted = extractOutermostJsonObject(cleaned);
    if (extracted) {
      try {
        return coerceAgentSubmission(JSON.parse(extracted), 'Groq agent trial completed.');
      } catch {
        // Try fallback slice below
      }
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return coerceAgentSubmission(
          JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)),
          'Groq agent trial completed.'
        );
      } catch {
        // Fall through
      }
    }
    throw Object.assign(new Error('Groq returned content that could not be parsed as JSON.'), {
      statusCode: 502,
    });
  }
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
  return 3000;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface GroqChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
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
    failed_generation?: string;
  };
}

export async function runLiveGroqAgentAttempt(params: {
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
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error('GROQ_API_KEY is not configured on the server. Add it in Settings > Secrets to run Groq models.'),
      { statusCode: 503 }
    );
  }

  const groqModel = normalizeGroqModelId(params.modelIdentifier);
  const isQwenModel = /^qwen\//i.test(groqModel);

  const normalizedProtected = normalizeProtectedTestFiles(params.protectedTestFiles);
  const safePriorityFiles = filterProtectedPriorityPaths(params.task.relevant_files, normalizedProtected);

  // Keep Groq prompt compact to stay within Groq's on-demand ITPM limit while preserving priority files
  const contextText = buildRepoContextExcerpt({
    files: params.files,
    maxBytes: isQwenModel ? 6000 : 12000,
    priorityPaths: safePriorityFiles,
    priorityFileCap: 10000,
    supportingFileCap: 1400,
    compactMode: true,
  });

  const concisenessNote = isQwenModel
    ? 'Keep summary to 1 sentence and code clean, minimal, and concise without redundant comments so the full JSON fits comfortably under 800 tokens.'
    : 'Return complete, clean code for each changed production file. Preserve all existing functions, classes, and routes; edit ONLY production source files.';

  const protectedGuardBlock = buildProtectedTestGuardPrompt(normalizedProtected, 30);

  const userPrompt = `Solve this coding task against the repository files below.
Return ONLY a valid JSON object (no markdown commentary outside JSON) with this exact structure:
{"summary":"short summary of edits","files":[{"path":"relative/file/path","operation":"modify","code":"complete updated file contents"}]}
${concisenessNote}
${protectedGuardBlock}
Task: ${params.task.title}
Description: ${params.task.description}
Requirements:
${params.task.requirements.slice(0, 6).map((r, i) => `${i + 1}. ${r}`).join('\n')}
Acceptance Criteria:
${params.task.acceptance_criteria.slice(0, 6).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Relevant Repository Files:
${contextText}`;

  const body: Record<string, unknown> = {
    model: groqModel,
    messages: [
      {
        role: 'system',
        content:
          'You are an autonomous software engineering agent solving a Harbor coding benchmark task. Output strictly valid JSON with keys "summary" (string) and "files" (non-empty array of objects with "path", "operation" in ["modify","create","delete"], and "code" containing the updated production file text). NEVER include any protected original test file path in "files". Properly escape newlines and quotes inside JSON strings.',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    temperature: 0.2,
    // Groq free-tier qwen/qwen3.8-27b has a 1,000 OTPM cap: disable thinking tokens & cap completion tokens <= 900
    max_completion_tokens: isQwenModel ? 900 : 4096,
    ...(isQwenModel ? { reasoning_effort: 'none' } : {}),
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const rawText = await response.text();
      let payload: GroqChatResponse | null = null;
      try {
        payload = JSON.parse(rawText) as GroqChatResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          `Groq API request failed with HTTP ${response.status}.`;
        // Graceful fallback if a specific model rejects max_completion_tokens or reasoning_effort
        if (response.status === 400 && /reasoning_effort/i.test(message) && 'reasoning_effort' in body) {
          delete body.reasoning_effort;
          continue;
        }
        if (response.status === 400 && /max_completion_tokens/i.test(message) && 'max_completion_tokens' in body) {
          const cap = body.max_completion_tokens;
          delete body.max_completion_tokens;
          body.max_tokens = cap;
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

      const content = payload?.choices?.[0]?.message?.content || '';
      const parsed = parseAgentJson(content);
      return {
        submittedFiles: parsed.files,
        inputTokens: payload?.usage?.prompt_tokens ?? 0,
        outputTokens: payload?.usage?.completion_tokens ?? 0,
        summary: parsed.summary,
        resolvedModel: `groq/${payload?.model || groqModel}`,
      };
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode || 502;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = status === 429 || status >= 500 || /not be parsed as JSON/i.test(msg);
      lastError = err instanceof Error ? err : new Error(msg);
      if (retryable && attempt < 2) {
        const delayMs = status === 429 ? parseRetryDelayMs(msg, null) : 1500;
        await sleep(delayMs);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || Object.assign(new Error('Groq API request failed.'), { statusCode: 502 });
}
