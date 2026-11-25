export interface AgentSubmittedFile {
  path: string;
  operation: string;
  code: string;
}

export interface ParsedAgentSubmission {
  summary: string;
  files: AgentSubmittedFile[];
}

export function normalizeRepoRelativePath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

export function normalizeProtectedTestFiles(protectedTestFiles?: string[]): string[] {
  return Array.from(
    new Set(
      (protectedTestFiles || [])
        .map((p) => normalizeRepoRelativePath(p))
        .filter(Boolean)
    )
  );
}

export function filterProtectedPriorityPaths(
  relevantFiles: string[] | undefined,
  normalizedProtected: string[]
): string[] {
  const protectedLower = new Set(normalizedProtected.map((p) => p.toLowerCase()));
  return (relevantFiles || []).filter(
    (p) => !protectedLower.has(normalizeRepoRelativePath(p).toLowerCase())
  );
}

export function buildProtectedTestGuardPrompt(
  normalizedProtected: string[],
  maxListed = 40
): string {
  if (normalizedProtected.length === 0) {
    return '\nPROTECTED-TEST RULE: Do NOT modify, create, or delete any existing test files. Edit ONLY production source files.\n';
  }
  const listed = normalizedProtected
    .slice(0, maxListed)
    .map((p) => `- ${p}`)
    .join('\n');
  return `\nPROTECTED ORIGINAL TEST FILES (READ-ONLY — DO NOT MODIFY, CREATE, OR DELETE ANY OF THESE PATHS):\n${listed}\nTouching any path listed above causes an automatic 0.0 verifier score (modified_protected_tests). Edit ONLY production source files.\n`;
}

export function buildRepoContextExcerpt(params: {
  files: Record<string, string>;
  maxBytes: number;
  priorityPaths?: string[];
  priorityFileCap?: number;
  supportingFileCap?: number;
  compactMode?: boolean;
}): string {
  const normalizedPriority = (params.priorityPaths || []).map((p) =>
    normalizeRepoRelativePath(p).toLowerCase()
  );
  const isPriorityFile = (filePath: string) => {
    const lower = normalizeRepoRelativePath(filePath).toLowerCase();
    return normalizedPriority.some(
      (p) => lower === p || lower.endsWith(`/${p}`) || p.endsWith(`/${lower}`)
    );
  };

  const entries = Object.entries(params.files).sort(([a], [b]) => {
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
  const priorityCap = params.priorityFileCap ?? 16000;
  const supportingCap = params.supportingFileCap ?? 2500;

  for (const [filePath, content] of entries) {
    if (usedBytes >= params.maxBytes) break;
    const priority = isPriorityFile(filePath);
    if (
      params.compactMode &&
      !priority &&
      chunks.length >= 3 &&
      usedBytes >= Math.floor(params.maxBytes * 0.65)
    ) {
      break;
    }
    const perFileCap = priority ? priorityCap : supportingCap;
    const slice = content.slice(0, Math.min(content.length, perFileCap, params.maxBytes - usedBytes));
    chunks.push(`--- FILE: ${filePath} ---\n${slice}`);
    usedBytes += Buffer.byteLength(slice, 'utf8');
  }

  return chunks.join('\n\n');
}

export function stripReasoningAndFences(raw: string): string {
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

export function extractOutermostJsonObject(text: string): string | null {
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

export function coerceAgentSubmission(
  parsed: unknown,
  defaultSummary: string
): ParsedAgentSubmission {
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
    summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : defaultSummary,
    files,
  };
}
