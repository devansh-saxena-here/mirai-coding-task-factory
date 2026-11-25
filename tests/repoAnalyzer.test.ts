import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { analyzeZipBuffer } from '../server/repoAnalyzer.ts';

function createSamplePythonZip(options?: { includeTraversal?: boolean }): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'sample-repo/pyproject.toml',
    Buffer.from('[project]\nname = "sample-api"\ndependencies = ["fastapi", "pydantic", "pytest"]\n', 'utf8')
  );
  zip.addFile(
    'sample-repo/README.md',
    Buffer.from('# Sample API\n\nDeterministic FastAPI service for MIRAI tests.\n', 'utf8')
  );
  zip.addFile(
    'sample-repo/src/app.py',
    Buffer.from('def add(a: int, b: int) -> int:\n    return a + b\n', 'utf8')
  );
  zip.addFile(
    'sample-repo/tests/test_app.py',
    Buffer.from('from src.app import add\n\ndef test_add():\n    assert add(2, 3) == 5\n', 'utf8')
  );
  zip.addFile(
    'sample-repo/node_modules/ignored/index.js',
    Buffer.from('console.log("should be ignored");\n', 'utf8')
  );
  if (options?.includeTraversal) {
    zip.addFile('placeholder.txt', Buffer.from('malicious traversal payload', 'utf8'));
    const injected = zip.getEntry('placeholder.txt');
    if (injected) {
      injected.entryName = 'sample-repo/../../escape.txt';
    }
  }
  return zip.toBuffer();
}

describe('repoAnalyzer.analyzeZipBuffer', () => {
  it('detects languages, frameworks, existing tests, and deterministic SHA-256 checksums', () => {
    const zipBuffer = createSamplePythonZip();
    const first = analyzeZipBuffer(zipBuffer, 'sample-repo.zip');
    const second = analyzeZipBuffer(zipBuffer, 'sample-repo.zip');

    assert.equal(first.analysis.project_name, 'sample-repo');
    assert.equal(first.analysis.source_type, 'zip');
    assert.equal(first.analysis.analysis_status, 'completed');
    assert.ok(first.analysis.detected_languages.includes('Python'));
    assert.ok(first.analysis.detected_frameworks.includes('FastAPI'));
    assert.ok(first.analysis.detected_frameworks.includes('Pydantic'));
    assert.ok(first.analysis.test_frameworks.includes('pytest'));
    assert.deepEqual(first.analysis.existing_test_files, ['tests/test_app.py']);
    assert.equal(first.analysis.content_sha256, second.analysis.content_sha256);
    assert.equal(first.analysis.snapshot_id, second.analysis.snapshot_id);
    assert.equal('node_modules/ignored/index.js' in first.files, false);
    assert.ok(first.analysis.readme_summary?.includes('Sample API'));
  });

  it('safely ignores Zip-Slip path traversal entries', () => {
    const zipBuffer = createSamplePythonZip({ includeTraversal: true });
    const { analysis, files } = analyzeZipBuffer(zipBuffer, 'sample-repo.zip');

    assert.equal(
      analysis.folder_structure.some((p) => p.includes('..') || p.includes('escape.txt')),
      false
    );
    assert.equal(
      Object.keys(files).some((p) => p.includes('..') || p.includes('escape.txt')),
      false
    );
    assert.ok('src/app.py' in files);
  });

  it('rejects non-ZIP buffers with a 400 error', () => {
    assert.throws(
      () => analyzeZipBuffer(Buffer.from('not-a-zip-archive', 'utf8'), 'invalid.zip'),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes('not a valid ZIP') &&
        (err as { statusCode?: number }).statusCode === 400
    );
  });
});
