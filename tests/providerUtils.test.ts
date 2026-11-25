import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProtectedTestGuardPrompt,
  buildRepoContextExcerpt,
  coerceAgentSubmission,
  extractOutermostJsonObject,
  filterProtectedPriorityPaths,
  normalizeProtectedTestFiles,
  normalizeRepoRelativePath,
  stripReasoningAndFences,
} from '../server/providerUtils.ts';

describe('providerUtils path & protected-test guards', () => {
  it('normalizes paths and deduplicates protected test lists', () => {
    assert.equal(normalizeRepoRelativePath('\\tests\\test_auth.py '), 'tests/test_auth.py');
    assert.deepEqual(
      normalizeProtectedTestFiles(['/tests/test_a.py', 'tests\\test_a.py', '', '  tests/test_b.py']),
      ['tests/test_a.py', 'tests/test_b.py']
    );
  });

  it('filters protected test files out of priority paths case-insensitively', () => {
    const protectedFiles = ['tests/test_core.py'];
    const filtered = filterProtectedPriorityPaths(
      ['src/core.py', '/TESTS/test_core.py', 'src/utils.py'],
      protectedFiles
    );
    assert.deepEqual(filtered, ['src/core.py', 'src/utils.py']);
  });

  it('builds explicit read-only guard prompt with protected paths', () => {
    const emptyPrompt = buildProtectedTestGuardPrompt([]);
    assert.match(emptyPrompt, /Do NOT modify, create, or delete any existing test files/);

    const listedPrompt = buildProtectedTestGuardPrompt(['tests/test_a.py', 'tests/test_b.py']);
    assert.match(listedPrompt, /modified_protected_tests/);
    assert.match(listedPrompt, /- tests\/test_a\.py/);
    assert.match(listedPrompt, /- tests\/test_b\.py/);
  });
});

describe('providerUtils context excerpts & JSON extraction', () => {
  it('prioritizes relevant files and respects maxBytes budget', () => {
    const excerpt = buildRepoContextExcerpt({
      files: {
        'tests/test_app.py': 'x'.repeat(200),
        'src/helper.py': 'y'.repeat(200),
        'src/target.py': 'def target(): return 1',
        'pyproject.toml': '[project]\nname = "demo"',
      },
      priorityPaths: ['src/target.py'],
      maxBytes: 120,
    });

    const targetPos = excerpt.indexOf('--- FILE: src/target.py ---');
    const manifestPos = excerpt.indexOf('--- FILE: pyproject.toml ---');
    assert.ok(targetPos >= 0, 'priority file should be included');
    assert.ok(manifestPos > targetPos, 'priority file should appear before manifest');
  });

  it('strips reasoning tags and markdown fences before extracting outermost JSON object', () => {
    const raw = `<think>Need to edit src/app.py with braces {"ignored": true}</think>
\`\`\`json
{
  "summary": "Implemented feature with {braces} in string",
  "files": [
    { "path": "src/app.py", "operation": "modify", "code": "def f():\\n    return {\\"ok\\": True}" }
  ]
}
\`\`\`
Trailing note.`;

    const cleaned = stripReasoningAndFences(raw);
    const jsonText = extractOutermostJsonObject(cleaned);
    assert.ok(jsonText);

    const submission = coerceAgentSubmission(JSON.parse(jsonText), 'Fallback');
    assert.equal(submission.summary, 'Implemented feature with {braces} in string');
    assert.equal(submission.files.length, 1);
    assert.equal(submission.files[0].path, 'src/app.py');
    assert.equal(submission.files[0].operation, 'modify');
  });

  it('uses defaultSummary and drops malformed file entries in coerceAgentSubmission', () => {
    const submission = coerceAgentSubmission(
      {
        summary: '   ',
        files: [null, { path: '', code: 'skip' }, { path: 'src/a.py', operation: 'CREATE', code: 'x=1' }],
      },
      'Default agent summary'
    );
    assert.equal(submission.summary, 'Default agent summary');
    assert.deepEqual(submission.files, [{ path: 'src/a.py', operation: 'create', code: 'x=1' }]);
  });
});
