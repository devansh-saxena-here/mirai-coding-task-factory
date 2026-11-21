import path from 'node:path';
import AdmZip from 'adm-zip';
import { sha256Hex } from './store.ts';
import type { RepoAnalysisResponse } from './types.ts';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.pytest_cache',
  '.mypy_cache',
  '.idea',
  '.vscode',
]);

const EXT_TO_LANG: Record<string, string> = {
  '.py': 'Python',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
};

const TEXT_EXTENSIONS = new Set([
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
  '.md',
  '.txt',
  '.cfg',
  '.ini',
  '.sh',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.html',
  '.css',
]);

const MAX_FILES = 1500;
const MAX_STORED_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_TEXT_BYTES = 1024 * 1024;

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.posix.basename(normalized);
  if (base === '__init__.py' || base === 'conftest.py') return false;
  return (
    base.startsWith('test_') ||
    base.endsWith('_test.py') ||
    base.includes('.test.') ||
    base.includes('.spec.') ||
    ((normalized.includes('/tests/') || normalized.startsWith('tests/') || normalized.includes('/__tests__/')) &&
      /\.(py|js|mjs|cjs|ts|tsx)$/.test(base) &&
      base.includes('test'))
  );
}

function detectFrameworksAndTests(filePaths: string[], files: Record<string, string>) {
  const frameworks = new Set<string>();
  const testFrameworks = new Set<string>();
  const existingTestFiles = filePaths.filter(isTestFile).slice(0, 60);

  const lowerNames = new Set(filePaths.map((p) => p.toLowerCase()));
  const manifestBlob = [
    files['pyproject.toml'] || '',
    files['requirements.txt'] || '',
    files['setup.cfg'] || '',
    files['setup.py'] || '',
    files['package.json'] || '',
  ]
    .join('\n')
    .toLowerCase();

  if (manifestBlob.includes('fastapi')) frameworks.add('FastAPI');
  if (manifestBlob.includes('django')) frameworks.add('Django');
  if (manifestBlob.includes('flask')) frameworks.add('Flask');
  if (manifestBlob.includes('pydantic')) frameworks.add('Pydantic');
  if (manifestBlob.includes('"react"')) frameworks.add('React');
  if (manifestBlob.includes('"next"')) frameworks.add('Next.js');
  if (manifestBlob.includes('"express"')) frameworks.add('Express');
  if (manifestBlob.includes('"vite"')) frameworks.add('Vite');

  const hasPyFiles = filePaths.some((p) => p.endsWith('.py'));
  if (
    manifestBlob.includes('pytest') ||
    lowerNames.has('pytest.ini') ||
    lowerNames.has('conftest.py') ||
    filePaths.some((p) => p.endsWith('/conftest.py'))
  ) {
    testFrameworks.add('pytest');
  }
  if (
    hasPyFiles &&
    (existingTestFiles.some((f) => (files[f] || '').includes('unittest')) || testFrameworks.size === 0)
  ) {
    testFrameworks.add(testFrameworks.has('pytest') ? 'pytest' : 'unittest');
  }
  if (manifestBlob.includes('vitest')) testFrameworks.add('vitest');
  if (manifestBlob.includes('jest')) testFrameworks.add('jest');

  const baselineCommands: Array<{ framework: string; working_directory: string; argv: string[] }> = [];
  if (testFrameworks.has('pytest')) {
    baselineCommands.push({ framework: 'pytest', working_directory: '.', argv: ['python', '-m', 'pytest', '-q'] });
  } else if (testFrameworks.has('unittest')) {
    baselineCommands.push({
      framework: 'unittest',
      working_directory: '.',
      argv: ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
    });
  } else if (testFrameworks.has('vitest')) {
    baselineCommands.push({ framework: 'vitest', working_directory: '.', argv: ['npx', 'vitest', 'run'] });
  } else if (testFrameworks.has('jest')) {
    baselineCommands.push({ framework: 'jest', working_directory: '.', argv: ['npx', 'jest'] });
  }

  return {
    detected_frameworks: Array.from(frameworks),
    test_frameworks: Array.from(testFrameworks),
    existing_test_files: existingTestFiles,
    baseline_test_commands: baselineCommands,
  };
}

function buildAnalysis(params: {
  projectName: string;
  sourceType: 'github' | 'zip';
  commitSha: string | null;
  repositoryIdentity: string;
  filePaths: string[];
  files: Record<string, string>;
}): RepoAnalysisResponse {
  const langCounts = new Map<string, number>();
  for (const filePath of params.filePaths) {
    const ext = path.posix.extname(filePath).toLowerCase();
    const lang = EXT_TO_LANG[ext];
    if (lang) {
      langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    }
  }
  const detectedLanguages = Array.from(langCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  const readmeKey = Object.keys(params.files).find((k) => /^readme(\.[a-z0-9]+)?$/i.test(path.posix.basename(k)));
  const readmeContent = readmeKey ? params.files[readmeKey].trim() : '';
  const readmeSummary = readmeContent ? readmeContent.slice(0, 1200) : null;

  const detected = detectFrameworksAndTests(params.filePaths, params.files);
  const contentSha = sha256Hex(
    params.filePaths
      .slice()
      .sort()
      .map((p) => `${p}:${sha256Hex(params.files[p] || '')}`)
      .join('\n')
  );

  return {
    project_name: params.projectName,
    source_type: params.sourceType,
    detected_languages: detectedLanguages,
    detected_frameworks: detected.detected_frameworks,
    file_count: params.filePaths.length,
    folder_structure: params.filePaths.slice(0, 250),
    readme_summary: readmeSummary,
    analysis_status: 'completed',
    commit_sha: params.commitSha,
    snapshot_id: `snap_${contentSha.slice(0, 16)}`,
    content_sha256: contentSha,
    repository_identity: params.repositoryIdentity,
    retrieved_at: new Date().toISOString(),
    test_frameworks: detected.test_frameworks,
    existing_test_files: detected.existing_test_files,
    baseline_test_commands: detected.baseline_test_commands,
  };
}

function shouldSkipPath(relPath: string): boolean {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.some((p) => p === '..' || p === '.' || IGNORED_DIRS.has(p))) return true;
  return false;
}

export function analyzeZipBuffer(
  buffer: Buffer,
  filename: string
): { analysis: RepoAnalysisResponse; files: Record<string, string> } {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw Object.assign(new Error('Uploaded file is not a valid ZIP archive.'), { statusCode: 400 });
  }

  const zip = new AdmZip(buffer);
  const rawEntries = zip.getEntries().filter((e) => !e.isDirectory);
  if (rawEntries.length === 0) {
    throw Object.assign(new Error('ZIP archive contains no files.'), { statusCode: 400 });
  }

  const normalizedNames = rawEntries.map((e) => e.entryName.replace(/\\/g, '/').replace(/^\/+/, ''));
  const firstSegments = new Set(normalizedNames.map((n) => n.split('/')[0]));
  const stripRoot = firstSegments.size === 1 && normalizedNames.every((n) => n.includes('/'));

  const filePaths: string[] = [];
  const files: Record<string, string> = {};
  let totalTextBytes = 0;

  for (let i = 0; i < rawEntries.length && filePaths.length < MAX_FILES; i++) {
    const entry = rawEntries[i];
    let relPath = normalizedNames[i];
    if (stripRoot) {
      relPath = relPath.slice(relPath.indexOf('/') + 1);
    }
    if (!relPath || shouldSkipPath(relPath)) continue;

    filePaths.push(relPath);
    const ext = path.posix.extname(relPath).toLowerCase();
    const isImportant =
      TEXT_EXTENSIONS.has(ext) || /^(readme|dockerfile|makefile|license)$/i.test(path.posix.basename(relPath));
    if (isImportant && entry.header.size <= MAX_STORED_FILE_BYTES && totalTextBytes < MAX_TOTAL_TEXT_BYTES) {
      const content = entry.getData().toString('utf8');
      files[relPath] = content;
      totalTextBytes += Buffer.byteLength(content, 'utf8');
    }
  }

  if (filePaths.length === 0) {
    throw Object.assign(new Error('No analyzable source files found in ZIP archive.'), { statusCode: 400 });
  }

  const projectName = filename.replace(/\.zip$/i, '').trim() || 'uploaded-repository';
  const analysis = buildAnalysis({
    projectName,
    sourceType: 'zip',
    commitSha: null,
    repositoryIdentity: `zip:${projectName}:${sha256Hex(buffer).slice(0, 12)}`,
    filePaths,
    files,
  });

  return { analysis, files };
}

export function parseGitHubRepoUrl(rawUrl: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw Object.assign(new Error('Invalid GitHub repository URL.'), { statusCode: 400 });
  }
  if (url.protocol !== 'https:' || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')) {
    throw Object.assign(new Error('Only public https://github.com repositories are supported.'), { statusCode: 400 });
  }
  const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw Object.assign(new Error('GitHub URL must include owner and repository name.'), { statusCode: 400 });
  }
  return { owner: parts[0], repo: parts[1] };
}

export async function analyzeGitHubRepository(
  repoUrl: string,
  commitSha?: string
): Promise<{ analysis: RepoAnalysisResponse; files: Record<string, string> }> {
  const { owner, repo } = parseGitHubRepoUrl(repoUrl);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MIRAI-Coding-Task-Factory/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (repoResp.status === 404) {
    throw Object.assign(new Error(`Repository ${owner}/${repo} was not found or is private.`), { statusCode: 404 });
  }
  if (repoResp.status === 403 || repoResp.status === 429) {
    throw Object.assign(new Error('GitHub API rate limit reached. Try uploading a ZIP archive instead.'), {
      statusCode: 429,
    });
  }
  if (!repoResp.ok) {
    throw Object.assign(new Error(`GitHub API error (${repoResp.status}) while loading repository metadata.`), {
      statusCode: 502,
    });
  }

  const repoMeta = (await repoResp.json()) as { default_branch?: string; name?: string; full_name?: string };
  const ref = commitSha?.trim() || repoMeta.default_branch || 'main';

  const commitResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    { headers }
  );
  if (commitResp.status === 404 || commitResp.status === 422) {
    throw Object.assign(new Error(`Revision "${ref}" was not found in ${owner}/${repo}.`), { statusCode: 404 });
  }
  if (!commitResp.ok) {
    throw Object.assign(new Error(`Could not resolve commit for ${owner}/${repo}@${ref}.`), { statusCode: 502 });
  }
  const commitMeta = (await commitResp.json()) as { sha: string };
  const resolvedSha = commitMeta.sha;

  // Download the repository zipball directly so we inspect the exact pinned revision
  const zipResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(resolvedSha)}`,
    { headers, redirect: 'follow' }
  );
  if (!zipResp.ok) {
    throw Object.assign(new Error(`Failed to download repository archive (${zipResp.status}).`), { statusCode: 502 });
  }

  const arrayBuffer = await zipResp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const parsed = analyzeZipBuffer(buffer, `${repo}.zip`);
  parsed.analysis.project_name = repoMeta.name || repo;
  parsed.analysis.source_type = 'github';
  parsed.analysis.commit_sha = resolvedSha;
  parsed.analysis.repository_identity = `https://github.com/${owner}/${repo}@${resolvedSha}`;

  return parsed;
}
