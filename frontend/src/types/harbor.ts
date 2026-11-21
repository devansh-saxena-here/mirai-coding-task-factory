import { SolutionResponse } from './solution';
import { TaskResponse } from './task';
import { TestSuiteResponse } from './testSuite';
import { ValidationReport } from './validation';

export type ValidationStatusLiteral = 'VALIDATED' | 'REJECTED' | 'NOT_VALIDATED';

export interface HarborTaskInfo {
  name: string;
  description: string;
  version: string;
}

export interface HarborMetadataConfig {
  difficulty: string;
  category: string;
  tags: string[];
  starting_commit_sha?: string | null;
  project_name: string;
  validation_status: ValidationStatusLiteral;
  network_policy?: 'docker-compose:none';
}

export interface HarborEnvironmentConfig {
  cpus?: number;
  memory_mb?: number;
  storage_mb?: number;
  workdir?: string;
  build_timeout_sec?: number;
}

export interface HarborAgentConfig {
  timeout_sec?: number;
}

export interface HarborVerifierConfig {
  timeout_sec?: number;
  environment_mode: 'separate';
  environment: HarborEnvironmentConfig;
}

export interface HarborTaskManifest {
  schema_version: string;
  task: HarborTaskInfo;
  metadata: HarborMetadataConfig;
  environment: HarborEnvironmentConfig;
  agent: HarborAgentConfig;
  verifier: HarborVerifierConfig;
  artifacts: Array<{ source: string; destination: string }>;
}

export interface HarborExportRequest {
  task: TaskResponse;
  solution: SolutionResponse;
  test_suite: TestSuiteResponse;
  validation_report?: ValidationReport | null;
  validation_id?: string;
  task_prefix?: string;
}

export interface HarborExportReport {
  task_id: string;
  validation_id?: string | null;
  snapshot_sha256?: string | null;
  harbor_task_name: string;
  export_directory: string;
  archive_path?: string | null;
  files_exported: string[];
  archive_size_bytes: number;
  validation_status_recorded: ValidationStatusLiteral;
  exported_at: string;
}
