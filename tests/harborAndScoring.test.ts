import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import AdmZip from 'adm-zip';
import { buildHarborExport } from '../server/harborBuilder.ts';
import { csvCell, evaluationSummaryCsv, evaluationTrialsCsv } from '../server/evaluationCsv.ts';
import {
  buildSuiteBreakdownFromRun,
  collectProtectedTestFiles,
  computePartialScore,
  countExpectedCases,
  emptySuiteBreakdown,
  makeRate,
  wilson95,
} from '../server/testBreakdown.ts';
import type {
  EvaluationReport,
  RepoAnalysisResponse,
  SolutionResponse,
  TaskResponse,
  TestCase,
  TestSuiteResponse,
} from '../server/types.ts';

function sampleTestCase(name: string, kind: 'feature' | 'regression' = 'feature'): TestCase {
  return {
    name,
    test_kind: kind,
    case_type: 'unit',
    description: `Verifies ${name}`,
    expected_behavior: `${name} passes`,
  };
}

describe('testBreakdown scoring helpers', () => {
  it('computes bounded Wilson 95% confidence intervals and rates', () => {
    assert.equal(wilson95(0, 0), null);
    const interval = wilson95(8, 10);
    assert.ok(interval);
    assert.ok(interval[0] >= 0 && interval[0] < 0.8);
    assert.ok(interval[1] > 0.8 && interval[1] <= 1);

    const rate = makeRate(3, 4);
    assert.equal(rate.value, 0.75);
    assert.equal(rate.numerator, 3);
    assert.equal(rate.denominator, 4);
    assert.ok(rate.wilson95);
  });

  it('calculates suite breakdowns and granular partial scores accurately', () => {
    const featureBreakdown = buildSuiteBreakdownFromRun(
      {
        supported: true,
        passed: false,
        totalExecuted: 4,
        passedCount: 3,
        failedCount: 1,
        errorCount: 0,
        skippedCount: 0,
        cases: [
          { name: 'test_a', status: 'passed' },
          { name: 'test_b', status: 'passed' },
          { name: 'test_c', status: 'passed' },
          { name: 'test_d', status: 'failed' },
        ],
        command: {
          argv: ['pytest'],
          working_directory: '.',
          exit_code: 1,
          duration_ms: 42,
          stdout: '',
          stderr: '',
          timed_out: false,
        },
      },
      'feature',
      4
    );

    const regressionBreakdown = emptySuiteBreakdown(2);
    assert.equal(featureBreakdown.pass_rate, 0.75);
    assert.equal(featureBreakdown.cases[0].kind, 'feature');
    assert.equal(regressionBreakdown.failed, 2);
    assert.equal(computePartialScore(featureBreakdown, regressionBreakdown), 0.5);
  });

  it('collects deduplicated protected test files from snapshot and regression metadata', () => {
    const expected = countExpectedCases(
      [
        {
          path: 'tests/test_feat.py',
          test_kind: 'feature',
          code: 'def test_1(): pass',
          test_cases: [sampleTestCase('test_1'), sampleTestCase('test_2')],
        },
      ],
      1
    );
    assert.equal(expected, 2);

    const protectedFiles = collectProtectedTestFiles(
      { existing_test_files: ['tests/test_existing.py', '/tests/test_shared.py'] },
      {
        original_regression_files: [
          { path: 'tests\\test_shared.py', sha256: 'abc123' },
          { path: 'tests/test_reg.py', sha256: 'def456' },
        ],
      }
    );
    assert.deepEqual(protectedFiles, [
      'tests/test_existing.py',
      'tests/test_shared.py',
      'tests/test_reg.py',
    ]);
  });
});

describe('harborBuilder.buildHarborExport & evaluationCsv', () => {
  it('generates a compliant Harbor v1.4 ZIP package with required manifest, solution, and verifier files', () => {
    const snapshot: RepoAnalysisResponse = {
      project_name: 'demo-calc',
      source_type: 'zip',
      detected_languages: ['Python'],
      detected_frameworks: [],
      file_count: 2,
      folder_structure: ['src/calc.py', 'tests/test_calc.py'],
      readme_summary: 'Demo calculator',
      analysis_status: 'completed',
      commit_sha: 'abc123def',
      snapshot_id: 'snap_demo1234',
      content_sha256: 'deadbeef',
      repository_identity: 'zip:demo-calc',
      retrieved_at: '2026-01-01T00:00:00.000Z',
      test_frameworks: ['pytest'],
      existing_test_files: ['tests/test_calc.py'],
      baseline_test_commands: [],
    };
    const task: TaskResponse = {
      id: 'task-101',
      title: 'Add multiply function',
      topic: 'Arithmetic',
      difficulty: 'easy',
      category: 'feature',
      description: 'Implement multiply(a, b) in src/calc.py.',
      requirements: ['Support integers and floats'],
      acceptance_criteria: ['multiply(3, 4) returns 12'],
      relevant_files: ['src/calc.py'],
      language: 'Python',
      project_name: 'demo-calc',
      snapshot_id: snapshot.snapshot_id,
      generated_at: '2026-01-01T00:00:00.000Z',
    };
    const solution: SolutionResponse = {
      id: 'sol-101',
      task_id: task.id,
      task_title: task.title,
      architecture_notes: 'Simple multiplication helper.',
      files: [
        {
          path: 'src/calc.py',
          status: 'modify',
          language: 'Python',
          code: 'def multiply(a, b):\n    return a * b\n',
          explanation: 'Added multiply function',
        },
      ],
      testing_guide: 'Run pytest',
      verification_steps: ['pytest -v'],
      generated_at: '2026-01-01T00:00:00.000Z',
    };
    const testSuite: TestSuiteResponse = {
      id: 'suite-101',
      task_id: task.id,
      task_title: task.title,
      repository: {
        project_name: 'demo-calc',
        source_type: 'zip',
        detected_language: 'Python',
        detected_frameworks: [],
        test_framework: 'pytest',
        existing_test_files: ['tests/test_calc.py'],
      },
      feature_test_files: [
        {
          path: 'tests/test_multiply.py',
          test_kind: 'feature',
          code: 'from src.calc import multiply\ndef test_mul(): assert multiply(3, 4) == 12\n',
          test_cases: [sampleTestCase('test_mul', 'feature')],
        },
      ],
      regression_test_files: [
        {
          path: 'tests/test_calc.py',
          test_kind: 'regression',
          code: 'def test_ok(): assert True\n',
          test_cases: [sampleTestCase('test_ok', 'regression')],
        },
      ],
      total_feature_tests: 1,
      total_regression_tests: 1,
      coverage_summary: 'Covers multiply and existing calc tests',
      execution_instructions: 'pytest -v',
      generated_at: '2026-01-01T00:00:00.000Z',
    };

    const { meta, buffer } = buildHarborExport({
      task,
      solution,
      testSuite,
      validation: null,
      snapshot,
      snapshotFiles: { 'src/calc.py': 'def add(a, b): return a + b\n' },
      taskPrefix: 'mirai',
    });

    assert.equal(meta.harbor_task_name, 'mirai-task-101');
    assert.equal(meta.filename, 'mirai-task-101.zip');
    assert.equal(meta.sha256.length, 64);

    const zip = new AdmZip(buffer);
    const entryNames = zip.getEntries().map((e) => e.entryName);
    const root = 'mirai-task-101/';
    for (const required of [
      `${root}task.toml`,
      `${root}instruction.md`,
      `${root}metadata.json`,
      `${root}environment/Dockerfile`,
      `${root}environment/repo/src/calc.py`,
      `${root}solution/solve.sh`,
      `${root}solution/files/src/calc.py`,
      `${root}tests/test.sh`,
      `${root}tests/files/tests/test_multiply.py`,
    ]) {
      assert.ok(entryNames.includes(required), `Missing required Harbor entry: ${required}`);
    }

    const testSh = zip.readAsText(`${root}tests/test.sh`);
    assert.match(testSh, /\/logs\/verifier\/reward\.txt/);
  });

  it('escapes RFC 4180 CSV cells and renders evaluation summary and trials CSVs', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a, "b"\nc'), '"a, ""b""\nc"');

    const report: EvaluationReport = {
      id: 'eval_1',
      task_id: 'task_1',
      mode: 'agent',
      state: 'completed',
      detail: 'Completed successfully',
      failure: null,
      harbor_version: '1.4',
      docker_engine: null,
      package: {
        snapshot_id: 'snap_1',
        snapshot_sha256: 'abc',
        starting_commit_sha: null,
        solution_sha256: 'sol_sha',
        test_suite_sha256: 'suite_sha',
        package_sha256: 'pkg_sha',
        runtime_image: 'python:3.11-slim',
        difficulty: 'medium',
        category: 'feature',
        language: 'Python',
      },
      oracle: null,
      baseline_control: null,
      trials: [
        {
          role: 'agent',
          origin: 'harbor',
          label: 'Gemini, "Pro"',
          attempt: 1,
          agent_name: 'mirai',
          agent_version: '1.0',
          configuration: { model: 'gemini/gemini-2.5-flash' },
          reward: 1,
          resolved_models: ['gemini/gemini-2.5-flash'],
          failure: null,
          flags: [],
          trustworthy: true,
          process: null,
          submitted_files: [],
          test_breakdown: {
            feature: { passed: 2, failed: 0, errors: 0, skipped: 0, total: 2, pass_rate: 1, cases: [] },
            regression: { passed: 1, failed: 0, errors: 0, skipped: 0, total: 1, pass_rate: 1, cases: [] },
            partial_score: 1,
            protected_guard_passed: true,
            protected_files_touched: [],
          },
        },
      ],
      metrics: [
        {
          label: 'Gemini, "Pro"',
          model: 'gemini/gemini-2.5-flash',
          scheduled: 1,
          scored: 1,
          verified_success: makeRate(1, 1),
          feature_pass: makeRate(1, 1),
          regression_pass: makeRate(1, 1),
          build_success: makeRate(1, 1),
          mean_partial_score: 1,
          feature_cases_passed: 2,
          feature_cases_total: 2,
          regression_cases_passed: 1,
          regression_cases_total: 1,
          mean_agent_seconds: 4.5,
          sample_agent_seconds_sd: 0,
          input_tokens_total: 1000,
          output_tokens_total: 200,
          cost_usd_total: null,
          failure_counts: {},
        },
      ],
    };

    const summaryCsv = evaluationSummaryCsv(report);
    assert.match(summaryCsv, /"Gemini, ""Pro"""/);
    assert.match(summaryCsv, /mean_partial_score/);

    const trialsCsv = evaluationTrialsCsv(report);
    assert.match(trialsCsv, /protected_guard_passed/);
    assert.match(trialsCsv, /gemini\/gemini-2\.5-flash,1,1,2,2,1,1,true,true/);
  });
});
