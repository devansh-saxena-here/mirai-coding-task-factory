import type { TaskResponse } from './types.ts';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const DEFAULT_GROQ_GPT_OSS_MODEL = 'groq/openai/gpt-oss-120b';
export const DEFAULT_GROQ_QWEN_MODEL = 'groq/qwen/qwen3.8-27b';

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function normalizeGroqModelId(modelIdentifier: string): string {
  return modelIdentifier.trim().replace(/^groq\//i, '');
}

function buildCompactContextExcerpt(
  files: Record<string, string>,
  maxBytes = 12000,
  priorityPaths: string[] = []
): string {
  const normalizedPriority = priorityPaths.map((p) => p.replace(/^\/+/, '').toLowerCase());
  const isPriorityFile = (filePath: string) => {
    const lower = filePath.replace(/^\/+/, '').toLowerCase();
    return normalizedPriority.some(
      (p) => lower === p || lower.endsWith(`/${p}`) || p.endsWith(`/${lower}`)
    );
  };

  const entries = Object.entries(files).sort(([a], [b]) => {
    const score = (p: string) => {
      const lower = p.toLowerCase();
      if (isPriorityFile(p)) return -1;
      if (lower === 'pyproject.toml' || lower === 'package.json' || lower === 'requirements.txt') return 0;
      if (lower.startsWith('readme')) return 1;
      if (lower.includes('test')) return 3;
      return 2;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });

  const chunks: string[] = [];
  let usedBytes = 0;

  // Include prioritized relevant files first; only fill remaining budget with a few supporting files
  for (const [filePath, content] of entries) {
    if (usedBytes >= maxBytes) break;
    const priority = isPriorityFile(filePath);
    if (!priority && chunks.length >= 3 && usedBytes >= Math.floor(maxBytes * 0.65)) {
      break;
    }
    const perFileCap = priority ? 10000 : 1400;
    const slice = content.slice(0, Math.min(content.length, perFileCap, maxBytes - usedBytes));
    chunks.push(`--- FILE: ${filePath} ---\n${slice}`);
    usedBytes += Buffer.byteLength(slice, 'utf8');
  }

  return chunks.join('\n\n');
}

function stripReasoningAndFences(raw: string): string {
  // Remove complete or unclosed <think>...</think> blocks emitted by reasoning models
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (/^<think>/i.test(text)) {
    const idx = text.indexOf('{');
    if (idx >= 0) text = text.slice(idx);
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  return text;
}

function extractOutermostJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

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
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseAgentJson(raw: string): {
  summary: string;
  files: Array<{ path: string; operation: string; code: string }>;
} {
  const cleaned = stripReasoningAndFences(raw);
  if (!cleaned) {
    throw Object.assign(new Error('Groq returned an empty response.'), { statusCode: 502 });
  }

  const coerce = (parsed: unknown) => {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Response is not a JSON object.');
    }
    const obj = parsed as { summary?: unknown; files?: unknown };
    const rawFiles = Array.isArray(obj.files) ? obj.files : [];
    const files = rawFiles
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
      .map((f) => ({
        path: String(f.path || '').trim(),
        operation: String(f.operation || 'modify').trim().toLowerCase(),
        code: typeof f.code === 'string' ? f.code : '',
      }))
      .filter((f) => f.path.length > 0);

    return {
      summary:
        typeof obj.summary === 'string' && obj.summary.trim()
          ? obj.summary.trim()
          : 'Groq agent trial completed.',
      files,
    };
  };

  try {
    return coerce(JSON.parse(cleaned));
  } catch {
    const extracted = extractOutermostJsonObject(cleaned);
    if (extracted) {
      try {
        return coerce(JSON.parse(extracted));
      } catch {
        // Try fallback slice below
      }
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return coerce(JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)));
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

  const normalizedProtected = Array.from(
    new Set(
      (params.protectedTestFiles || [])
        .map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').trim())
        .filter(Boolean)
    )
  );
  const protectedLower = new Set(normalizedProtected.map((p) => p.toLowerCase()));
  const safePriorityFiles = (params.task.relevant_files || []).filter(
    (p) => !protectedLower.has(p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
  );

  // Keep Groq prompt compact to stay within Groq's on-demand ITPM limit while preserving priority files
  const contextText = buildCompactContextExcerpt(
    params.files,
    isQwenModel ? 6000 : 12000,
    safePriorityFiles
  );

  const concisenessNote = isQwenModel
    ? 'Keep summary to 1 sentence and code clean, minimal, and concise without redundant comments so the full JSON fits comfortably under 800 tokens.'
    : 'Return complete, clean code for each changed production file. Preserve all existing functions, classes, and routes; edit ONLY production source files.';

  const protectedGuardBlock =
    normalizedProtected.length > 0
      ? `\nPROTECTED ORIGINAL TEST FILES (READ-ONLY — DO NOT MODIFY, CREATE, OR DELETE):\n${normalizedProtected
          .slice(0, 30)
          .map((p) => `- ${p}`)
          .join('\n')}\nTouching any path listed above causes an automatic 0.0 score (modified_protected_tests).\n`
      : '\nPROTECTED-TEST RULE: Do NOT modify, create, or delete any existing test files.\n';

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
