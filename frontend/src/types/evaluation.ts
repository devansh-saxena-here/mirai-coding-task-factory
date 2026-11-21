export interface Rate {
  numerator: number;
  denominator: number;
  value: number | null;
  wilson95: [number, number] | null;
}
export interface EvaluationProvidersStatus {
  gemini: {
    configured: boolean;
    default_model: string;
  };
  groq: {
    configured: boolean;
    default_models: {
      gpt_oss: string;
      qwen: string;
    };
  };
  adaption: {
    configured: boolean;
    default_model: string;
    long_context_model: string;
  };
}

export interface TestCaseOutcome {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  kind: 'feature' | 'regression';
}

export interface SuiteBreakdown {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  total: number;
  pass_rate: number | null;
  cases: TestCaseOutcome[];
}

export interface TrialTestBreakdown {
  feature: SuiteBreakdown;
  regression: SuiteBreakdown;
  partial_score: number | null;
  protected_guard_passed: boolean;
  protected_files_touched: string[];
}

export interface BenchmarkMetrics {
  label: string;
  model?: string;
  scheduled: number;
  scored: number;
  verified_success: Rate;
  feature_pass: Rate;
  regression_pass: Rate;
  build_success: Rate;
  mean_partial_score?: number | null;
  feature_cases_passed?: number;
  feature_cases_total?: number;
  regression_cases_passed?: number;
  regression_cases_total?: number;
  mean_agent_seconds: number | null;
  sample_agent_seconds_sd: number | null;
  input_tokens_total: number | null;
  output_tokens_total: number | null;
  cost_usd_total: number | null;
  failure_counts: Record<string, number>;
}
export interface Trial {
  requested_model?: string | null;
  configuration?: { model: string } | null;
  role: 'oracle' | 'agent' | 'control';
  origin: 'harbor' | 'test_double';
  label: string;
  attempt: number;
  agent_name: string | null;
  agent_version: string | null;
  resolved_models: string[];
  reward: 0 | 1 | null;
  trustworthy: boolean;
  failure: string | null;
  flags: string[];
  process: { argv: string[]; exit_code: number | null; console_log: string; timed_out: boolean } | null;
  submitted_files: { path: string; operation: string }[] | null;
  test_breakdown?: TrialTestBreakdown | null;
}
export interface EvaluationReport {
  id: string;
  task_id: string;
  mode: 'agent' | 'control';
  state: 'queued' | 'running' | 'completed' | 'blocked' | 'quarantined' | 'failed';
  detail: string | null;
  failure: string | null;
  harbor_version: string | null;
  docker_engine: string | null;
  package: {
    snapshot_id: string; snapshot_sha256: string; starting_commit_sha: string | null;
    solution_sha256: string; test_suite_sha256: string; package_sha256: string;
    runtime_image: string; language: string; category: string; difficulty: string;
    protected_test_files?: string[];
  } | null;
  oracle: Trial | null;
  baseline_control: Trial | null;
  trials: Trial[];
  metrics: BenchmarkMetrics[];
}

export type LeaderboardScope = 'latest_per_task' | 'all_runs';

export interface LeaderboardModelEntry {
  model_key: string;
  label: string;
  display_name: string;
  model: string;
  provider: 'gemini' | 'groq' | 'adaption' | 'other';
  tasks_evaluated: number;
  campaigns_count: number;
  scheduled: number;
  scored: number;
  verified_success: Rate;
  feature_pass: Rate;
  regression_pass: Rate;
  build_success: Rate;
  mean_partial_score?: number | null;
  feature_cases_passed?: number;
  feature_cases_total?: number;
  regression_cases_passed?: number;
  regression_cases_total?: number;
  mean_agent_seconds: number | null;
  input_tokens_total: number | null;
  output_tokens_total: number | null;
  total_tokens: number | null;
  avg_tokens_per_trial: number | null;
  cost_usd_total: number | null;
  failure_counts: Record<string, number>;
  top_failure: string | null;
}

export interface LeaderboardFailureBucket {
  category: string;
  total: number;
  by_model: Record<string, number>;
}

export interface LeaderboardTaskModelCell {
  model_key: string;
  display_name: string;
  scored: number;
  scheduled: number;
  passed: number;
  pass_rate: number | null;
  mean_agent_seconds: number | null;
  total_tokens: number | null;
  top_failure: string | null;
}

export interface LeaderboardTaskRow {
  task_id: string;
  task_title: string;
  project_name: string;
  language: string;
  difficulty: string;
  category: string;
  evaluation_id: string;
  evaluated_at: string;
  models: Record<string, LeaderboardTaskModelCell>;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  filters: {
    language: string | null;
    difficulty: string | null;
    category: string | null;
  };
  available_filters: {
    languages: string[];
    difficulties: string[];
    categories: string[];
  };
  summary: {
    tasks_evaluated: number;
    campaigns_count: number;
    total_trials_scheduled: number;
    total_trials_scored: number;
    total_trials_passed: number;
    overall_pass_rate: number | null;
    leading_model: {
      model_key: string;
      display_name: string;
      pass_rate: number | null;
      scored: number;
    } | null;
    fastest_model: {
      model_key: string;
      display_name: string;
      mean_agent_seconds: number;
    } | null;
  };
  models: LeaderboardModelEntry[];
  failure_breakdown: LeaderboardFailureBucket[];
  task_matrix: LeaderboardTaskRow[];
  generated_at: string;
}
