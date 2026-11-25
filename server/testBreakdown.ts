import type { TestSuiteRunResult } from './sandboxRunner.ts';
import type {
  Rate,
  RepoAnalysisResponse,
  SuiteBreakdown,
  TestCaseOutcome,
  TestSuiteResponse,
} from './types.ts';
import { normalizeRepoRelativePath } from './providerUtils.ts';

export function wilson95(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function makeRate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : null,
    wilson95: wilson95(numerator, denominator),
  };
}

export function countExpectedCases(
  testFiles: TestSuiteResponse['feature_test_files'],
  fallbackTotal = 0
): number {
  const fromMeta = testFiles.reduce((sum, tf) => sum + (tf.test_cases?.length || 0), 0);
  if (fromMeta > 0) return fromMeta;
  if (fallbackTotal > 0) return fallbackTotal;
  return testFiles.length;
}

export function emptySuiteBreakdown(expectedTotal: number): SuiteBreakdown {
  return {
    passed: 0,
    failed: expectedTotal,
    errors: 0,
    skipped: 0,
    total: expectedTotal,
    pass_rate: expectedTotal > 0 ? 0 : null,
    cases: [],
  };
}

export function buildSuiteBreakdownFromRun(
  run: TestSuiteRunResult,
  kind: 'feature' | 'regression',
  expectedTotal: number
): SuiteBreakdown {
  const passed = run.passedCount || 0;
  const failed = run.failedCount || 0;
  const errors = run.errorCount || 0;
  const skipped = run.skippedCount || 0;
  const executed = Math.max(run.totalExecuted || 0, passed + failed + errors);
  const total = executed > 0 ? executed : expectedTotal;
  const effectiveFailed =
    executed > 0 ? failed : run.passed ? 0 : Math.max(0, total - passed - errors);
  const cases: TestCaseOutcome[] = (run.cases || []).map((c) => ({
    name: c.name,
    status: c.status,
    kind,
  }));

  return {
    passed,
    failed: effectiveFailed,
    errors,
    skipped,
    total,
    pass_rate: total > 0 ? Number((passed / total).toFixed(4)) : null,
    cases,
  };
}

export function computePartialScore(
  feature: SuiteBreakdown,
  regression: SuiteBreakdown
): number | null {
  const total = feature.total + regression.total;
  if (total <= 0) return null;
  return Number(((feature.passed + regression.passed) / total).toFixed(4));
}

export function collectProtectedTestFiles(
  snapshot: Pick<RepoAnalysisResponse, 'existing_test_files'> | null | undefined,
  testSuite: Pick<TestSuiteResponse, 'original_regression_files'> | null | undefined
): string[] {
  return Array.from(
    new Set(
      [
        ...(snapshot?.existing_test_files || []),
        ...((testSuite?.original_regression_files || []).map((f) =>
          typeof f === 'string' ? f : f.path
        )),
      ]
        .map((p) => normalizeRepoRelativePath(p))
        .filter(Boolean)
    )
  );
}
