import { RepoAnalysisResponse } from './repo';
import { SolutionResponse } from './solution';
import { TaskResponse } from './task';

export type TestKind = 'feature' | 'regression';

export type TestCaseType =
  | 'happy_path'
  | 'edge_case'
  | 'invalid_input'
  | 'error_handling'
  | 'acceptance_criterion'
  | 'regression_check'
  | 'boundary'
  | 'state_transition'
  | 'authorization'
  | 'persistence'
  | 'transaction'
  | 'concurrency';

export interface CoverageRow {
  id: string;
  text: string;
  feature_tests: Array<{ file_path: string; selector: string; case_id: string }>;
  suggested_scenarios: TestCaseType[];
}

interface TestCommand {
  framework: string;
  working_directory: string;
  argv: string[];
}

export interface TestCase {
  id?: string;
  name: string;
  test_kind: TestKind;
  case_type: TestCaseType;
  description: string;
  target_criterion?: string | null;
  expected_behavior: string;
  requirement_ids?: string[];
  acceptance_criteria_ids?: string[];
  baseline_evidence?: Array<{ path: string; excerpt: string }>;
  negative_control?: {
    strategy: 'untreated_baseline' | 'mutated_reference';
    behavior_to_break: string;
    expected_failure: 'assertion_failure';
  } | null;
}

export interface TestFile {
  path: string;
  test_kind: TestKind;
  framework?: string;
  code: string;
  test_cases: TestCase[];
  dependencies?: Array<{ distribution: string; declared_in: string }>;
  content_sha256?: string | null;
}

export interface RepositoryMetadata {
  project_name: string;
  source_type: 'github' | 'zip' | 'local' | 'unknown';
  starting_commit_sha?: string | null;
  detected_language: string;
  detected_frameworks: string[];
  test_framework: string;
  test_framework_config_file?: string | null;
  existing_test_files: string[];
  environment_info?: Record<string, string>;
}

export interface TestSuiteRequest {
  task: TaskResponse;
  solution?: SolutionResponse | null;
  repo_analysis?: RepoAnalysisResponse | null;
  starting_commit_sha?: string | null;
  preferred_framework?: string | null;
}

export interface TestSuiteResponse {
  id: string;
  task_id: string;
  task_title: string;
  repository: RepositoryMetadata;
  feature_test_files: TestFile[];
  regression_test_files: TestFile[];
  original_regression_files?: Array<{ path: string; sha256: string }>;
  coverage_matrix?: CoverageRow[];
  requirement_coverage?: CoverageRow[];
  execution_plan?: {
    working_directory: string;
    feature: TestCommand[];
    original_regression: TestCommand[];
    generated_regression: TestCommand[];
  } | null;
  quality_status?: 'legacy_unverified' | 'structurally_checked';
  execution_status?: 'not_run';
  total_feature_tests: number;
  total_regression_tests: number;
  coverage_summary: string;
  execution_instructions: string;
  generated_at: string;
}
