import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  applyFileChanges,
  cleanupWorkspace,
  createIsolatedWorkspace,
  parseIndividualTestCases,
  runCommandInSandbox,
  safeResolveWorkspacePath,
} from '../server/sandboxRunner.ts';

describe('sandboxRunner.parseIndividualTestCases', () => {
  it('parses MIRAI Python runner output format', () => {
    const output = [
      'PASSED tests/test_math.py::test_add',
      'FAILED tests/test_math.py::test_div',
      'ERROR tests/test_math.py::test_boom',
      'SKIPPED tests/test_math.py::test_future',
      'MIRAI_SUMMARY: total=3 passed=1 failed=1 errors=1 skipped=1 duration=0.12s',
    ].join('\n');

    const cases = parseIndividualTestCases(output);
    assert.deepEqual(cases, [
      { name: 'tests/test_math.py::test_add', status: 'passed' },
      { name: 'tests/test_math.py::test_div', status: 'failed' },
      { name: 'tests/test_math.py::test_boom', status: 'error' },
      { name: 'tests/test_math.py::test_future', status: 'skipped' },
    ]);
  });

  it('parses pytest verbose format', () => {
    const output = [
      'tests/test_api.py::test_health PASSED [ 50%]',
      'tests/test_api.py::test_auth FAILED [100%]',
    ].join('\n');

    const cases = parseIndividualTestCases(output);
    assert.deepEqual(cases, [
      { name: 'tests/test_api.py::test_health', status: 'passed' },
      { name: 'tests/test_api.py::test_auth', status: 'failed' },
    ]);
  });

  it('parses node --test spec and TAP formats', () => {
    const specOutput = ['✔ handles valid input (1.4ms)', '✖ rejects bad input (2.1ms)'].join('\n');
    assert.deepEqual(parseIndividualTestCases(specOutput), [
      { name: 'handles valid input', status: 'passed' },
      { name: 'rejects bad input', status: 'failed' },
    ]);

    const tapOutput = [
      'ok 1 - parses payload',
      'not ok 2 - enforces auth',
      'ok 3 - optional feature # SKIP not enabled',
    ].join('\n');
    assert.deepEqual(parseIndividualTestCases(tapOutput), [
      { name: 'parses payload', status: 'passed' },
      { name: 'enforces auth', status: 'failed' },
      { name: 'optional feature', status: 'skipped' },
    ]);
  });
});

describe('sandboxRunner workspace safety & env isolation', () => {
  it('blocks path traversal and null bytes in safeResolveWorkspacePath', () => {
    const root = '/tmp/mirai-test-root';
    assert.equal(safeResolveWorkspacePath(root, '../etc/passwd'), null);
    assert.equal(safeResolveWorkspacePath(root, 'src/../../secret.env'), null);
    assert.equal(safeResolveWorkspacePath(root, 'src/file\0.py'), null);
    assert.equal(safeResolveWorkspacePath(root, ''), null);

    const valid = safeResolveWorkspacePath(root, 'src/app.py');
    assert.equal(valid, path.resolve(root, 'src/app.py'));
  });

  it('applies file changes, rejects unsafe writes, and strips secret env vars in child processes', () => {
    const workspace = createIsolatedWorkspace({
      'src/hello.js': 'export const value = 1;\n',
    });

    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'mirai-test-secret-should-not-leak';

    try {
      const badApply = applyFileChanges(workspace, [
        { path: '../escape.js', operation: 'create', code: 'boom' },
      ]);
      assert.equal(badApply.ok, false);
      assert.match(badApply.error || '', /Unsafe or invalid/);

      const goodApply = applyFileChanges(workspace, [
        { path: 'src/hello.js', operation: 'modify', code: 'export const value = 42;\n' },
        { path: 'src/extra.txt', operation: 'create', code: 'created' },
      ]);
      assert.equal(goodApply.ok, true);
      assert.equal(fs.readFileSync(path.join(workspace, 'src/hello.js'), 'utf8'), 'export const value = 42;\n');

      const delApply = applyFileChanges(workspace, [
        { path: 'src/extra.txt', operation: 'delete', code: '' },
      ]);
      assert.equal(delApply.ok, true);
      assert.equal(fs.existsSync(path.join(workspace, 'src/extra.txt')), false);

      // Verify child process cannot read parent process secrets
      const cmdRes = runCommandInSandbox(workspace, [
        process.execPath,
        '-e',
        'process.stdout.write(JSON.stringify({ key: process.env.GEMINI_API_KEY || null, nodeEnv: process.env.NODE_ENV }))',
      ]);
      assert.equal(cmdRes.exit_code, 0);
      const parsed = JSON.parse(cmdRes.stdout) as { key: string | null; nodeEnv: string };
      assert.equal(parsed.key, null);
      assert.equal(parsed.nodeEnv, 'test');
    } finally {
      if (prevKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = prevKey;
      }
      cleanupWorkspace(workspace);
    }
  });
});
