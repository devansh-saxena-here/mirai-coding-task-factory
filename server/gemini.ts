import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { randomHex, sha256Hex } from './store.ts';
import type {
  RepoAnalysisResponse,
  SolutionResponse,
  TaskResponse,
  TestSuiteResponse,
  ValidationReport,
} from './types.ts';

const VALID_GEMINI_MODEL_RE = /^(?:models\/)?gemini-[a-z0-9][a-z0-9.-]{1,64}$/i;
const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const MODEL_ALIASES: Record<string, string> = {
  'gemini-3.5-flash-lite': FALLBACK_GEMINI_MODEL,
  'gemini-3.5-flash': DEFAULT_GEMINI_MODEL,
  'gemini-2.0-flash': FALLBACK_GEMINI_MODEL,
  'gemini-2.0-flash-lite': FALLBACK_GEMINI_MODEL,
  'gemini-1.5-flash': FALLBACK_GEMINI_MODEL,
  'gemini-1.5-pro': DEFAULT_GEMINI_MODEL,
};

function resolveModelName(candidate?: string): string {
  const trimmed = (candidate || '').trim().replace(/^models\//i, '').replace(/^gemini\//i, '');
  const lower = trimmed.toLowerCase();
  if (lower && MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }
  if (trimmed && VALID_GEMINI_MODEL_RE.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_GEMINI_MODEL;
}

function getClient(): { ai: GoogleGenAI; model: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to enable AI generation.'),
      { statusCode: 503 }
    );
  }
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const model = resolveModelName(process.env.GEMINI_MODEL);
  return { ai, model };
}

function parseGeminiError(err: unknown): {
  status: number;
  message: string;
  retryable: boolean;
  fallbackModel: boolean;
} {
  let status = 502;
  let message = err instanceof Error ? err.message : 'Gemini API request failed.';

  if (err && typeof err === 'object') {
    const obj = err as { status?: number; statusCode?: number };
    if (typeof obj.status === 'number') status = obj.status;
    else if (typeof obj.statusCode === 'number') status = obj.statusCode;
  }

  try {
    const parsed = JSON.parse(message) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error) {
      if (typeof parsed.error.code === 'number') status = parsed.error.code;
      if (typeof parsed.error.message === 'string') message = parsed.error.message;
    }
  } catch {
    // Plain text message
  }

  const retryable = status === 503 || status === 429 || status === 500 || status === 504;
  const fallbackModel =
    retryable ||
    status === 404 ||
    (status === 400 && /model|not found|unsupported/i.test(message));
  return { status, message, retryable, fallbackModel };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  ai: GoogleGenAI,
  primaryModel: string,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
) {
  const candidates = Array.from(new Set([primaryModel, DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODEL]));

  let lastParsed: { status: number; message: string } | null = null;

  for (let mIdx = 0; mIdx < candidates.length; mIdx++) {
    const model = candidates[mIdx];
    const maxAttempts = mIdx === 0 ? 2 : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          ...params,
          config: {
            ...params.config,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
      } catch (err) {
        const info = parseGeminiError(err);
        lastParsed = info;
        if (!info.fallbackModel) {
          throw Object.assign(new Error(info.message), { statusCode: info.status });
        }
        if (!info.retryable) {
          // Model not found / unsupported: move immediately to the next fallback model
          break;
        }
        if (attempt < maxAttempts - 1) {
          await sleep(1000 * (attempt + 1));
        }
      }
    }
  }

  throw Object.assign(
    new Error(lastParsed?.message || 'Gemini API is temporarily unavailable. Please try again.'),
    { statusCode: lastParsed?.status || 503 }
  );
}

function buildContextExcerpt(
  files: Record<string, string>,
  maxBytes = 28000,
  priorityPaths: string[] = []
): {
  contextText: string;
  contextFiles: Array<{ path: string; kind: 'source' | 'test' | 'config' | 'readme'; complete: boolean }>;
  inputBytes: number;
} {
  const prioritySet = new Set(priorityPaths.map((p) => p.replace(/^\/+/, '').toLowerCase()));
  const entries = Object.entries(files).sort(([a], [b]) => {
    const score = (p: string) => {
      const lower = p.toLowerCase();
      if (prioritySet.has(lower)) return -1;
      if (lower.startsWith('readme')) return 0;
      if (lower === 'pyproject.toml' || lower === 'package.json' || lower === 'requirements.txt') return 1;
      if (lower.includes('test')) return 3;
      return 2;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });

  const chunks: string[] = [];
  const contextFiles: Array<{ path: string; kind: 'source' | 'test' | 'config' | 'readme'; complete: boolean }> = [];
  let usedBytes = 0;

  for (const [filePath, content] of entries) {
    if (usedBytes >= maxBytes) break;
    const lower = filePath.toLowerCase();
    const isPriority = prioritySet.has(lower);
    const kind: 'source' | 'test' | 'config' | 'readme' = lower.includes('readme')
      ? 'readme'
      : lower.includes('test')
        ? 'test'
        : /\.(json|toml|ya?ml|ini|cfg)$/.test(lower)
          ? 'config'
          : 'source';

    const perFileCap = isPriority ? 24000 : 6000;
    const slice = content.slice(0, Math.min(content.length, perFileCap, maxBytes - usedBytes));
    const complete = slice.length === content.length;
    chunks.push(`--- FILE: ${filePath}${complete ? '' : ' (TRUNCATED)'} ---\n${slice}`);
    contextFiles.push({ path: filePath, kind, complete });
    usedBytes += Buffer.byteLength(slice, 'utf8');
  }

  return { contextText: chunks.join('\n\n'), contextFiles, inputBytes: usedBytes };
}

function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const base = normalized.split('/').pop() || normalized;
  return (
    normalized.includes('/tests/') ||
    normalized.startsWith('tests/') ||
    normalized.includes('/__tests__/') ||
    base.startsWith('test_') ||
    base.endsWith('_test.py') ||
    base.includes('.test.') ||
    base.includes('.spec.')
  );
}

function parseJsonResponse<T>(raw: string | undefined): T {
  const cleaned = (raw || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!cleaned) {
    throw Object.assign(new Error('Gemini returned an empty response.'), { statusCode: 502 });
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw Object.assign(new Error('Gemini returned content that is not valid JSON.'), { statusCode: 502 });
  }
}

export async function generateTopicTask(input: {
  topic: string;
  difficulty?: string;
  language?: string;
  category?: string;
}): Promise<TaskResponse> {
  const { ai, model } = getClient();
  const difficulty = input.difficulty || 'medium';
  const language = input.language || 'Python';
  const category = input.category || 'backend';

  const response = await generateWithRetry(ai, model, {
    contents: `Create a concrete, self-contained software engineering benchmark task.
Topic: ${input.topic}
Difficulty: ${difficulty}
Language: ${language}
Category: ${category}

Return realistic requirements (3-6 items), testable acceptance criteria (3-6 items), and relevant file paths.`,
    config: {
      systemInstruction:
        'You are MIRAI, a benchmark task authoring engine. Produce precise, deterministic, verifiable engineering task specifications in JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
          acceptance_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
          relevant_files: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'requirements', 'acceptance_criteria', 'relevant_files'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    title: string;
    description: string;
    requirements: string[];
    acceptance_criteria: string[];
    relevant_files: string[];
  }>(response.text);

  return {
    id: `task_${randomHex(8)}`,
    topic: input.topic,
    difficulty,
    language,
    category,
    title: parsed.title,
    description: parsed.description,
    requirements: parsed.requirements,
    acceptance_criteria: parsed.acceptance_criteria,
    relevant_files: parsed.relevant_files,
    generated_at: new Date().toISOString(),
    project_name: null,
    snapshot_id: null,
    starting_commit_sha: null,
  };
}

export async function generateContextualTask(params: {
  analysis: RepoAnalysisResponse;
  files: Record<string, string>;
  difficulty?: string;
  focus_area?: string | null;
  category?: string | null;
}): Promise<TaskResponse> {
  const { ai, model } = getClient();
  const { contextText } = buildContextExcerpt(params.files, 24000);
  const difficulty = params.difficulty || 'medium';
  const language = params.analysis.detected_languages[0] || 'Python';
  const category = params.category || 'backend';

  const response = await generateWithRetry(ai, model, {
    contents: `Analyze this repository snapshot and design a realistic, verifiable coding task grounded in the actual files.
Project: ${params.analysis.project_name}
Detected languages: ${params.analysis.detected_languages.join(', ') || 'Unknown'}
Detected frameworks: ${params.analysis.detected_frameworks.join(', ') || 'None'}
Test frameworks: ${params.analysis.test_frameworks.join(', ') || 'None'}
Difficulty: ${difficulty}
Category: ${category}
Focus area: ${params.focus_area || 'Choose a high-value feature or bugfix grounded in the existing codebase'}

Folder structure (first 120 paths):
${params.analysis.folder_structure.slice(0, 120).join('\n')}

Repository files excerpt:
${contextText}`,
    config: {
      systemInstruction:
        'You are MIRAI, a coding benchmark task factory. Reference real file paths from the repository. Keep scope tightly bounded, verifiable by automated tests, and free of ambiguity.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          topic: { type: Type.STRING },
          description: { type: Type.STRING },
          requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
          acceptance_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
          relevant_files: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'topic', 'description', 'requirements', 'acceptance_criteria', 'relevant_files'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    title: string;
    topic: string;
    description: string;
    requirements: string[];
    acceptance_criteria: string[];
    relevant_files: string[];
  }>(response.text);

  const existingTestsSet = new Set(
    (params.analysis.existing_test_files || []).map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
  );
  const prodRelevantFiles = (parsed.relevant_files || []).filter((p) => {
    const clean = p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    return !existingTestsSet.has(clean) && !isTestFilePath(clean);
  });

  return {
    id: `task_${randomHex(8)}`,
    topic: parsed.topic || params.focus_area || params.analysis.project_name,
    difficulty,
    language,
    category,
    title: parsed.title,
    description: parsed.description,
    requirements: parsed.requirements,
    acceptance_criteria: parsed.acceptance_criteria,
    relevant_files: prodRelevantFiles.length > 0 ? prodRelevantFiles : parsed.relevant_files,
    generated_at: new Date().toISOString(),
    project_name: params.analysis.project_name,
    snapshot_id: params.analysis.snapshot_id,
    starting_commit_sha: params.analysis.commit_sha,
  };
}

export async function generateReferenceSolution(params: {
  task: TaskResponse;
  files: Record<string, string>;
  existingTestFiles?: string[];
}): Promise<SolutionResponse> {
  const { ai, model } = getClient();
  const protectedTestSet = new Set(
    (params.existingTestFiles || []).map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
  );
  const nonTestRelevant = (params.task.relevant_files || []).filter((p) => {
    const clean = p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    return !protectedTestSet.has(clean) && !isTestFilePath(clean);
  });
  const { contextText, contextFiles, inputBytes } = buildContextExcerpt(
    params.files,
    60000,
    nonTestRelevant.length > 0 ? nonTestRelevant : params.task.relevant_files || []
  );
  const reqEntries = params.task.requirements.map((text, i) => ({ id: `REQ-${i + 1}`, text }));
  const acEntries = params.task.acceptance_criteria.map((text, i) => ({ id: `AC-${i + 1}`, text }));
  const protectedList = Array.from(protectedTestSet);

  const response = await generateWithRetry(ai, model, {
    contents: `Produce a complete reference implementation for the following task.
Do NOT modify or include ANY test files (tests belong in Stage 3 Test Suite, never in the Reference Solution).${
      protectedList.length > 0
        ? `\nProtected original test files (FORBIDDEN to include or edit): ${protectedList.join(', ')}`
        : ''
    }
Return COMPLETE full file contents for created or modified production source files only.
CRITICAL: Preserve EVERY existing function, class, route, and export in every modified file — never delete, omit, or truncate unrelated existing code.

Task title: ${params.task.title}
Language: ${params.task.language}
Description: ${params.task.description}
Requirements:
${reqEntries.map((r) => `- ${r.id}: ${r.text}`).join('\n')}
Acceptance Criteria:
${acEntries.map((c) => `- ${c.id}: ${c.text}`).join('\n')}
Relevant files: ${params.task.relevant_files.join(', ')}

Repository snapshot context:
${contextText || '(Topic-only task, no source snapshot attached.)'}`,
    config: {
      systemInstruction:
        'You are MIRAI Reference Solution Synthesizer. Output clean, production-grade full file contents mapped to requirement IDs (REQ-*) and acceptance criteria IDs (AC-*). Never modify existing test files and NEVER delete or omit existing functions, classes, or API routes in modified files.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          architecture_notes: { type: Type.STRING },
          testing_guide: { type: Type.STRING },
          verification_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
          files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                status: { type: Type.STRING },
                language: { type: Type.STRING },
                code: { type: Type.STRING },
                explanation: { type: Type.STRING },
                requirement_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
                acceptance_criteria_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['path', 'status', 'language', 'code', 'explanation'],
            },
          },
        },
        required: ['architecture_notes', 'testing_guide', 'verification_steps', 'files'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    architecture_notes: string;
    testing_guide: string;
    verification_steps: string[];
    files: Array<{
      path: string;
      status: string;
      language: string;
      code: string;
      explanation: string;
      requirement_ids?: string[];
      acceptance_criteria_ids?: string[];
    }>;
  }>(response.text);

  const allNormalizedFiles = (parsed.files || []).map((f) => {
    const cleanPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseContent = params.files[cleanPath];
    const normalizedStatus: 'create' | 'modify' | 'delete' =
      f.status === 'delete' ? 'delete' : baseContent !== undefined ? 'modify' : 'create';
    return {
      path: cleanPath,
      status: normalizedStatus,
      language: f.language || params.task.language,
      code: f.code || '',
      explanation: f.explanation || '',
      requirement_ids: f.requirement_ids?.length ? f.requirement_ids : reqEntries.map((r) => r.id),
      acceptance_criteria_ids: f.acceptance_criteria_ids?.length
        ? f.acceptance_criteria_ids
        : acEntries.map((c) => c.id),
      base_sha256: baseContent !== undefined ? sha256Hex(baseContent) : null,
      result_sha256: normalizedStatus === 'delete' ? null : sha256Hex(f.code || ''),
    };
  });

  // Never allow Stage 2 Reference Solution to touch protected existing test files or bundle Stage 3 test files
  const withoutProtectedTests = allNormalizedFiles.filter((f) => {
    const lower = f.path.toLowerCase();
    return !protectedTestSet.has(lower) && !isTestFilePath(lower);
  });
  const normalizedFiles =
    withoutProtectedTests.length > 0
      ? withoutProtectedTests
      : allNormalizedFiles.filter((f) => !protectedTestSet.has(f.path.toLowerCase()));

  return {
    id: `sol_${randomHex(8)}`,
    task_id: params.task.id,
    task_title: params.task.title,
    snapshot_id: params.task.snapshot_id ?? null,
    context_files: contextFiles,
    requirements: reqEntries,
    acceptance_criteria: acEntries,
    structural_check: {
      status: params.task.snapshot_id ? 'applied_to_snapshot' : 'not_checked',
      execution_status: 'not_run',
      model_attempts: 1,
      input_bytes: inputBytes,
      estimated_input_tokens: Math.ceil(inputBytes / 4),
    },
    architecture_notes: parsed.architecture_notes,
    files: normalizedFiles,
    testing_guide: parsed.testing_guide,
    verification_steps: parsed.verification_steps,
    generated_at: new Date().toISOString(),
  };
}

export async function generateTestSuite(params: {
  task: TaskResponse;
  solution: SolutionResponse | null;
  analysis: RepoAnalysisResponse | null;
  files: Record<string, string>;
}): Promise<TestSuiteResponse> {
  const { ai, model } = getClient();
  const reqEntries = params.task.requirements.map((text, i) => ({ id: `REQ-${i + 1}`, text }));
  const acEntries = params.task.acceptance_criteria.map((text, i) => ({ id: `AC-${i + 1}`, text }));
  const framework = params.analysis?.test_frameworks[0] || (params.task.language.toLowerCase() === 'python' ? 'pytest' : 'vitest');

  const extractDeclaredSymbols = (code: string): string[] => {
    const matches = new Set<string>();
    for (const m of code.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
      if (m[1]) matches.add(m[1]);
    }
    for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
      if (m[1]) matches.add(m[1]);
    }
    return Array.from(matches);
  };

  const solutionSummary = params.solution
    ? params.solution.files
        .map((f) => {
          const symbols = extractDeclaredSymbols(f.code || '');
          const symbolHeader = symbols.length > 0 ? `\nDeclared symbols in ${f.path}: ${symbols.join(', ')}` : '';
          return `--- SOLUTION FILE (${f.status}): ${f.path} ---${symbolHeader}\n${(f.code || '').slice(0, 24000)}`;
        })
        .join('\n\n')
    : '(No reference solution yet.)';

  const response = await generateWithRetry(ai, model, {
    contents: `Generate a traceable, directly executable automated test suite using ${framework} for this coding task.
Include feature test files covering every requirement (REQ-*) and acceptance criterion (AC-*), plus regression test files preserving existing repository behavior.

Execution rules (CRITICAL):
- Import ONLY exact symbol names actually declared in the Reference Solution files shown below (check the "Declared symbols" list — NEVER guess or rename function/class names!).
- Import directly from the exact module paths present in the repository snapshot and Reference Solution.
- For Python repositories, use standard-library unittest or standard pytest syntax (assert, pytest.raises, pytest.approx, pytest.mark.parametrize, tmp_path, monkeypatch) and avoid introducing external third-party packages not declared by the repository.
- For JavaScript repositories without a preinstalled test runner, prefer Node's built-in node:test and node:assert/strict.
- Feature tests MUST fail when run against the unmodified starting repository and MUST pass when the Reference Solution is applied.

Task: ${params.task.title}
Language: ${params.task.language}
Description: ${params.task.description}
Requirements:
${reqEntries.map((r) => `- ${r.id}: ${r.text}`).join('\n')}
Acceptance Criteria:
${acEntries.map((c) => `- ${c.id}: ${c.text}`).join('\n')}

Reference Solution (COMPLETE files):
${solutionSummary}`,
    config: {
      systemInstruction:
        'You are MIRAI Automated Test Suite Generator. Output clean, directly runnable native tests in JSON with explicit requirement_ids, acceptance_criteria_ids, and negative controls. Never fabricate non-existent imports or third-party dependencies.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          coverage_summary: { type: Type.STRING },
          execution_instructions: { type: Type.STRING },
          feature_test_files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                code: { type: Type.STRING },
                test_cases: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      case_type: { type: Type.STRING },
                      description: { type: Type.STRING },
                      expected_behavior: { type: Type.STRING },
                      requirement_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
                      acceptance_criteria_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['name', 'case_type', 'description', 'expected_behavior'],
                  },
                },
              },
              required: ['path', 'code', 'test_cases'],
            },
          },
          regression_test_files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                code: { type: Type.STRING },
                test_cases: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      case_type: { type: Type.STRING },
                      description: { type: Type.STRING },
                      expected_behavior: { type: Type.STRING },
                    },
                    required: ['name', 'case_type', 'description', 'expected_behavior'],
                  },
                },
              },
              required: ['path', 'code', 'test_cases'],
            },
          },
        },
        required: ['coverage_summary', 'execution_instructions', 'feature_test_files', 'regression_test_files'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    coverage_summary: string;
    execution_instructions: string;
    feature_test_files: Array<{
      path: string;
      code: string;
      test_cases: Array<{
        name: string;
        case_type: string;
        description: string;
        expected_behavior: string;
        requirement_ids?: string[];
        acceptance_criteria_ids?: string[];
      }>;
    }>;
    regression_test_files: Array<{
      path: string;
      code: string;
      test_cases: Array<{
        name: string;
        case_type: string;
        description: string;
        expected_behavior: string;
      }>;
    }>;
  }>(response.text);

  const featureFiles = (parsed.feature_test_files || []).map((tf, fIdx) => ({
    path: tf.path.replace(/^\/+/, ''),
    test_kind: 'feature' as const,
    framework,
    code: tf.code,
    content_sha256: sha256Hex(tf.code),
    test_cases: (tf.test_cases || []).map((tc, cIdx) => ({
      id: `FT-${fIdx + 1}-${cIdx + 1}`,
      name: tc.name,
      test_kind: 'feature' as const,
      case_type: tc.case_type || 'acceptance_criterion',
      description: tc.description,
      expected_behavior: tc.expected_behavior,
      requirement_ids: tc.requirement_ids?.length ? tc.requirement_ids : [reqEntries[0]?.id].filter(Boolean),
      acceptance_criteria_ids: tc.acceptance_criteria_ids?.length
        ? tc.acceptance_criteria_ids
        : [acEntries[cIdx % Math.max(acEntries.length, 1)]?.id].filter(Boolean),
      negative_control: {
        strategy: 'untreated_baseline' as const,
        behavior_to_break: tc.expected_behavior,
        expected_failure: 'assertion_failure' as const,
      },
    })),
  }));

  const regressionFiles = (parsed.regression_test_files || []).map((tf, fIdx) => ({
    path: tf.path.replace(/^\/+/, ''),
    test_kind: 'regression' as const,
    framework,
    code: tf.code,
    content_sha256: sha256Hex(tf.code),
    test_cases: (tf.test_cases || []).map((tc, cIdx) => ({
      id: `RT-${fIdx + 1}-${cIdx + 1}`,
      name: tc.name,
      test_kind: 'regression' as const,
      case_type: tc.case_type || 'regression_check',
      description: tc.description,
      expected_behavior: tc.expected_behavior,
    })),
  }));

  const coverageMatrix = acEntries.map((ac) => ({
    id: ac.id,
    text: ac.text,
    feature_tests: featureFiles.flatMap((tf) =>
      tf.test_cases
        .filter((tc) => tc.acceptance_criteria_ids?.includes(ac.id))
        .map((tc) => ({ file_path: tf.path, selector: tc.name, case_id: tc.id || tc.name }))
    ),
    suggested_scenarios: ['happy_path', 'edge_case'],
  }));

  const requirementCoverage = reqEntries.map((req) => ({
    id: req.id,
    text: req.text,
    feature_tests: featureFiles.flatMap((tf) =>
      tf.test_cases
        .filter((tc) => tc.requirement_ids?.includes(req.id))
        .map((tc) => ({ file_path: tf.path, selector: tc.name, case_id: tc.id || tc.name }))
    ),
    suggested_scenarios: ['acceptance_criterion', 'invalid_input'],
  }));

  const originalRegressionFiles = (params.analysis?.existing_test_files || []).map((filePath) => ({
    path: filePath,
    sha256: sha256Hex(params.files[filePath] || filePath),
  }));

  const runCmd = (paths: string[]) =>
    paths.length > 0
      ? [
          {
            framework,
            working_directory: '.',
            argv: framework === 'pytest' ? ['python', '-m', 'pytest', '-q', ...paths] : ['npx', framework, ...paths],
          },
        ]
      : [];

  return {
    id: `suite_${randomHex(8)}`,
    task_id: params.task.id,
    task_title: params.task.title,
    repository: {
      project_name: params.analysis?.project_name || params.task.project_name || 'standalone-task',
      source_type: params.analysis?.source_type || 'unknown',
      starting_commit_sha: params.analysis?.commit_sha || params.task.starting_commit_sha || null,
      detected_language: params.task.language,
      detected_frameworks: params.analysis?.detected_frameworks || [],
      test_framework: framework,
      test_framework_config_file: null,
      existing_test_files: params.analysis?.existing_test_files || [],
    },
    feature_test_files: featureFiles,
    regression_test_files: regressionFiles,
    original_regression_files: originalRegressionFiles,
    coverage_matrix: coverageMatrix,
    requirement_coverage: requirementCoverage,
    execution_plan: {
      working_directory: '.',
      feature: runCmd(featureFiles.map((f) => f.path)),
      original_regression: params.analysis?.baseline_test_commands || [],
      generated_regression: runCmd(regressionFiles.map((f) => f.path)),
    },
    quality_status: 'structurally_checked',
    execution_status: 'not_run',
    total_feature_tests: featureFiles.reduce((acc, f) => acc + f.test_cases.length, 0),
    total_regression_tests: regressionFiles.reduce((acc, f) => acc + f.test_cases.length, 0),
    coverage_summary: parsed.coverage_summary,
    execution_instructions: parsed.execution_instructions,
    generated_at: new Date().toISOString(),
  };
}

export async function runLiveGeminiAgentAttempt(params: {
  modelIdentifier: string;
  task: TaskResponse;
  files: Record<string, string>;
  protectedTestFiles?: string[];
}): Promise<{
  submittedFiles: Array<{ path: string; operation: string; code: string }>;
  inputTokens: number;
  outputTokens: number;
  summary: string;
}> {
  const { ai } = getClient();
  const modelToUse = resolveModelName(params.modelIdentifier.replace(/^gemini\//i, ''));
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
  const { contextText } = buildContextExcerpt(params.files, 50000, safePriorityFiles);

  const protectedGuardBlock =
    normalizedProtected.length > 0
      ? `\nPROTECTED ORIGINAL TEST FILES (READ-ONLY — DO NOT MODIFY, CREATE, OR DELETE ANY OF THESE PATHS):\n${normalizedProtected
          .slice(0, 40)
          .map((p) => `- ${p}`)
          .join('\n')}\nTouching any path listed above causes an automatic 0.0 verifier score (modified_protected_tests). Edit ONLY production source files.\n`
      : '\nPROTECTED-TEST RULE: Do NOT modify, create, or delete any existing test files. Edit ONLY production source files.\n';

  const response = await generateWithRetry(ai, modelToUse, {
    contents: `Solve the following engineering task against the starting repository. Return the COMPLETE modified/created production source files without deleting or truncating any existing unrelated functions, classes, or routes.
${protectedGuardBlock}
Title: ${params.task.title}
Description: ${params.task.description}
Requirements:
${params.task.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Acceptance Criteria:
${params.task.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Starting Repository Files:
${contextText}`,
    config: {
      systemInstruction:
        'You are an autonomous coding agent solving a Harbor benchmark task. Return JSON with summary and files array containing ONLY production source file edits. Never include protected original test files in the files array.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                operation: { type: Type.STRING },
                code: { type: Type.STRING },
              },
              required: ['path', 'operation', 'code'],
            },
          },
        },
        required: ['summary', 'files'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    summary: string;
    files: Array<{ path: string; operation: string; code: string }>;
  }>(response.text);

  const usage = response.usageMetadata;
  return {
    submittedFiles: parsed.files || [],
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    summary: parsed.summary || 'Agent trial completed.',
  };
}

export async function repairValidationArtifacts(params: {
  task: TaskResponse;
  solution: SolutionResponse;
  testSuite: TestSuiteResponse;
  analysis: RepoAnalysisResponse | null;
  snapshotFiles: Record<string, string>;
  validationReport: ValidationReport;
  gateLogs: Record<string, string>;
}): Promise<{
  diagnosis: string;
  repairedTarget: 'solution' | 'tests' | 'both';
  repairedSolution: SolutionResponse | null;
  repairedTestSuite: TestSuiteResponse | null;
}> {
  const { ai, model } = getClient();
  const existingTestList = params.analysis?.existing_test_files || [];
  const protectedTestSet = new Set(
    existingTestList.map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
  );

  const extractDeclaredSymbols = (code: string): string[] => {
    const matches = new Set<string>();
    for (const m of code.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
      if (m[1]) matches.add(m[1]);
    }
    for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
      if (m[1]) matches.add(m[1]);
    }
    return Array.from(matches);
  };

  const failedGatesSummary = (params.validationReport.gates || [])
    .map((g) => {
      const logContent = (params.gateLogs[g.gate] || '').slice(0, 6000);
      return [
        `### Gate: ${g.gate} | Status: ${g.status} | Failure Category: ${g.failure_category || 'none'}`,
        `Detail: ${g.detail || 'none'}`,
        logContent ? `Log:\n${logContent}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const solutionSection = params.solution.files
    .map((f) => {
      const symbols = extractDeclaredSymbols(f.code || '');
      const symLine = symbols.length > 0 ? `\nDeclared symbols: ${symbols.join(', ')}` : '';
      return `--- SOLUTION FILE (${f.status}): ${f.path} ---${symLine}\n${(f.code || '').slice(0, 20000)}`;
    })
    .join('\n\n');

  const featureTestsSection = params.testSuite.feature_test_files
    .map((f) => `--- FEATURE TEST FILE: ${f.path} ---\n${(f.code || '').slice(0, 14000)}`)
    .join('\n\n');

  const regressionTestsSection = params.testSuite.regression_test_files
    .map((f) => `--- REGRESSION TEST FILE: ${f.path} ---\n${(f.code || '').slice(0, 14000)}`)
    .join('\n\n');

  const originalTargetsSection = params.solution.files
    .filter((f) => f.path in params.snapshotFiles)
    .map((f) => `--- ORIGINAL SNAPSHOT FILE: ${f.path} ---\n${params.snapshotFiles[f.path].slice(0, 16000)}`)
    .join('\n\n');

  const protectedWarning =
    existingTestList.length > 0
      ? `\nPROTECTED ORIGINAL TEST FILES (NEVER include these in solution_files — modifying them causes immediate rejection):\n${existingTestList.slice(0, 30).map((p) => `- ${p}`).join('\n')}`
      : '';

  const response = await generateWithRetry(ai, model, {
    contents: `You are repairing a failed Coding Task Factory validation package.
Read the exact validation failure logs below, diagnose the root cause, and return ONLY the corrected artifact(s) needed to make ALL 5 validation gates PASS (baseline, reference, feature, regression, negative_control).

Critical rules:
1. Diagnose precisely from the stderr/traceback:
   - If the Reference Solution has a syntax/runtime bug, missing edge case, broke existing functions, or touched a protected original test file -> set repaired_target="solution" (or "both") and return COMPLETE corrected solution_files (NEVER truncate unrelated existing functions/classes/routes, NEVER include protected original test files!).
   - If the Test Suite has an ImportError, wrong symbol/function name, incorrect assertion/mock setup, or failed negative_control (vacuous pass on untreated baseline) -> set repaired_target="tests" (or "both") and return COMPLETE corrected feature_test_files and regression_test_files.
   - If feature tests passed on the untreated snapshot (negative_control_vacuous_pass), strengthen feature_test_files so they MUST fail on the ORIGINAL snapshot and MUST pass with the Reference Solution!
2. Every file you return MUST be COMPLETE, syntactically valid, runnable code (never partial diffs or ellipses).
3. Imports in tests MUST match exact module paths and exact declared symbol names in the solution/snapshot.
4. For Python tests, use standard-library unittest or standard pytest syntax (assert, pytest.raises, pytest.approx, pytest.mark.parametrize, tmp_path, monkeypatch) without adding undeclared third-party packages.
${protectedWarning}

Task: ${params.task.title}
Language: ${params.task.language}
Description: ${params.task.description}
Requirements:
${params.task.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Acceptance Criteria:
${params.task.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Validation Failure Report & Logs:
Overall Verdict: ${params.validationReport.overall_verdict}
Rejection Reasons:
${params.validationReport.rejection_reasons.map((r) => `- ${r}`).join('\n') || '- See gate logs below'}

${failedGatesSummary}

Original Snapshot Files (Untreated Baseline):
${originalTargetsSection || '(New files only)'}

Current Reference Solution:
${solutionSection}

Current Feature Tests:
${featureTestsSection || '(None)'}

Current Regression Tests:
${regressionTestsSection || '(None)'}`,
    config: {
      systemInstruction:
        'You are MIRAI Self-Healing Validation Repair Engine. Diagnose failing benchmark validation logs and output minimal, complete, syntactically valid JSON repairs for solution_files and/or test files so all 5 validation gates pass.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          diagnosis: { type: Type.STRING },
          repaired_target: { type: Type.STRING },
          solution_files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                status: { type: Type.STRING },
                language: { type: Type.STRING },
                code: { type: Type.STRING },
                explanation: { type: Type.STRING },
              },
              required: ['path', 'status', 'language', 'code', 'explanation'],
            },
          },
          feature_test_files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                code: { type: Type.STRING },
              },
              required: ['path', 'code'],
            },
          },
          regression_test_files: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                path: { type: Type.STRING },
                code: { type: Type.STRING },
              },
              required: ['path', 'code'],
            },
          },
        },
        required: ['diagnosis', 'repaired_target'],
      },
    },
  });

  const parsed = parseJsonResponse<{
    diagnosis: string;
    repaired_target: string;
    solution_files?: Array<{
      path: string;
      status: string;
      language: string;
      code: string;
      explanation: string;
    }>;
    feature_test_files?: Array<{ path: string; code: string }>;
    regression_test_files?: Array<{ path: string; code: string }>;
  }>(response.text);

  const normalizedTarget: 'solution' | 'tests' | 'both' =
    parsed.repaired_target === 'solution' || parsed.repaired_target === 'both'
      ? parsed.repaired_target
      : 'tests';

  let repairedSolution: SolutionResponse | null = null;
  if (
    (normalizedTarget === 'solution' || normalizedTarget === 'both') &&
    Array.isArray(parsed.solution_files) &&
    parsed.solution_files.length > 0
  ) {
    const cleanSolutionFiles = parsed.solution_files
      .map((f) => {
        const cleanPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
        const base = params.snapshotFiles[cleanPath];
        const status: 'create' | 'modify' | 'delete' =
          f.status === 'delete' ? 'delete' : base !== undefined ? 'modify' : 'create';
        return {
          path: cleanPath,
          status,
          language: f.language || params.task.language.toLowerCase(),
          code: f.code,
          explanation: f.explanation || 'Auto-repaired based on validation logs.',
          base_sha256: base !== undefined ? sha256Hex(base) : null,
          result_sha256: sha256Hex(f.code),
        };
      })
      .filter((f) => f.path.length > 0 && !protectedTestSet.has(f.path.toLowerCase()));

    if (cleanSolutionFiles.length > 0) {
      repairedSolution = {
        ...params.solution,
        id: `sol_${randomHex(8)}`,
        files: cleanSolutionFiles,
        architecture_notes: `${params.solution.architecture_notes}\n\n[Auto-Repair] ${parsed.diagnosis}`,
        generated_at: new Date().toISOString(),
      };
    }
  }

  let repairedTestSuite: TestSuiteResponse | null = null;
  const hasNewFeatureTests =
    Array.isArray(parsed.feature_test_files) && parsed.feature_test_files.length > 0;
  const hasNewRegressionTests =
    Array.isArray(parsed.regression_test_files) && parsed.regression_test_files.length > 0;

  if (
    (normalizedTarget === 'tests' || normalizedTarget === 'both') &&
    (hasNewFeatureTests || hasNewRegressionTests)
  ) {
    const framework = params.testSuite.repository.test_framework || 'pytest';
    const nextFeatureFiles = hasNewFeatureTests
      ? parsed.feature_test_files!.map((tf, idx) => {
          const cleanPath = tf.path.replace(/\\/g, '/').replace(/^\/+/, '');
          const prevMatch =
            params.testSuite.feature_test_files.find((p) => p.path === cleanPath) ||
            params.testSuite.feature_test_files[idx];
          return {
            path: cleanPath,
            test_kind: 'feature' as const,
            framework,
            code: tf.code,
            content_sha256: sha256Hex(tf.code),
            test_cases: prevMatch?.test_cases || [
              {
                id: `FT-${idx + 1}-1`,
                name: 'repaired_feature_tests',
                test_kind: 'feature' as const,
                case_type: 'acceptance_criterion',
                description: 'Auto-repaired feature test coverage.',
                expected_behavior: 'Verifies task requirements against reference solution.',
              },
            ],
          };
        })
      : params.testSuite.feature_test_files;

    const nextRegressionFiles = hasNewRegressionTests
      ? parsed.regression_test_files!.map((tf, idx) => {
          const cleanPath = tf.path.replace(/\\/g, '/').replace(/^\/+/, '');
          const prevMatch =
            params.testSuite.regression_test_files.find((p) => p.path === cleanPath) ||
            params.testSuite.regression_test_files[idx];
          return {
            path: cleanPath,
            test_kind: 'regression' as const,
            framework,
            code: tf.code,
            content_sha256: sha256Hex(tf.code),
            test_cases: prevMatch?.test_cases || [
              {
                id: `RT-${idx + 1}-1`,
                name: 'repaired_regression_tests',
                test_kind: 'regression' as const,
                case_type: 'regression_check',
                description: 'Auto-repaired regression test coverage.',
                expected_behavior: 'Preserves existing repository behavior.',
              },
            ],
          };
        })
      : params.testSuite.regression_test_files;

    repairedTestSuite = {
      ...params.testSuite,
      id: `suite_${randomHex(8)}`,
      feature_test_files: nextFeatureFiles,
      regression_test_files: nextRegressionFiles,
      total_feature_tests: nextFeatureFiles.reduce((acc, f) => acc + Math.max(1, f.test_cases.length), 0),
      total_regression_tests: nextRegressionFiles.reduce((acc, f) => acc + Math.max(1, f.test_cases.length), 0),
      coverage_summary: `${params.testSuite.coverage_summary}\n\n[Auto-Repair] ${parsed.diagnosis}`,
      generated_at: new Date().toISOString(),
    };
  }

  // Ensure actual repairedTarget reflects what was really changed
  const actualTarget: 'solution' | 'tests' | 'both' =
    repairedSolution && repairedTestSuite
      ? 'both'
      : repairedSolution
        ? 'solution'
        : 'tests';

  if (!repairedSolution && !repairedTestSuite) {
    throw Object.assign(
      new Error('Auto-repair did not produce updated solution or test files. Try regenerating the failing stage manually.'),
      { statusCode: 502 }
    );
  }

  return {
    diagnosis: parsed.diagnosis?.trim() || 'Repaired failing validation artifacts using gate error logs.',
    repairedTarget: actualTarget,
    repairedSolution,
    repairedTestSuite,
  };
}
