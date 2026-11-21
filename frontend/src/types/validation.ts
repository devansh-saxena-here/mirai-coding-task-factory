import { SolutionResponse } from './solution';
import { TaskResponse } from './task';
import { TestSuiteResponse } from './testSuite';

export type ExecutionMode = 'static' | 'trusted_local' | 'isolated' | 'docker' | 'harbor';
export type OverallVerdict = 'VALIDATED' | 'REJECTED' | 'NOT_VALIDATED';
export type BaselineStatus = 'passed' | 'failed' | 'not_run' | 'skipped';
export type MutationStatus = 'passed' | 'failed' | 'not_run';

export type GateName = 'baseline' | 'reference' | 'feature' | 'regression' | 'negative_control';

export interface GateEvidence {
  gate: GateName;
  status: 'passed' | 'failed' | 'not_run';
  failure_category?: string | null;
  detail?: string | null;
  runs: Array<{
    commands?: { argv: string[]; working_directory: string; exit_code: number | null }[];
    exit_code: number | null;
    duration_ms: number;
    log_location?: string | null;
    timed_out: boolean;
    oom_killed: boolean;
  }>;
}

export interface TestExecutionResult {
  test_file: string;
  test_kind: string;
  exit_code: number;
  duration_ms: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  individual_cases?: Array<Record<string, unknown>>;
}

export interface AutoRepairSummary {
  diagnosis: string;
  repaired_target: 'solution' | 'tests' | 'both';
  source_validation_id: string;
  repaired_at: string;
}

export interface ValidationReport {
  id: string;
  task_id: string;
  solution_id: string;
  test_suite_id: string;
  snapshot_id?: string | null;
  snapshot_sha256?: string | null;
  evidence_location?: string | null;
  failure_category?: string | null;
  gates?: GateEvidence[];
  starting_commit_sha?: string | null;
  execution_mode: ExecutionMode;
  baseline_status: BaselineStatus;
  baseline_result?: TestExecutionResult | null;
  solution_applied_successfully: boolean;
  created_files: string[];
  modified_files: string[];
  deleted_files?: string[];
  feature_tests_result?: TestExecutionResult | null;
  regression_tests_result?: TestExecutionResult | null;
  mutation_test_status: MutationStatus;
  mutation_test_result?: TestExecutionResult | null;
  overall_verdict: OverallVerdict;
  rejection_reasons: string[];
  execution_duration_ms: number;
  auto_repair?: AutoRepairSummary | null;
  created_at: string;
}

export interface ValidationRequest {
  task: TaskResponse;
  solution: SolutionResponse;
  test_suite: TestSuiteResponse;
  execution_mode?: ExecutionMode;
  authorized_deletions?: string[];
  starting_commit_sha?: string | null;
}


