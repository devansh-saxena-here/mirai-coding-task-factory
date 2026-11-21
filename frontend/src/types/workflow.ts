import type { RepoAnalysisResponse } from './repo';
import type { TaskResponse } from './task';
import type { SolutionResponse } from './solution';
import type { TestSuiteResponse } from './testSuite';
import type { ValidationReport } from './validation';

export type Kind = 'solution' | 'tests' | 'validation' | 'repair' | 'export' | 'evaluation';
export interface JobProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string | null;
}

export interface JobProgress {
  percent: number;
  completed_steps: number;
  total_steps: number;
  stage: string;
  detail?: string | null;
  steps?: JobProgressStep[];
}

export interface Job {
  id: string;
  kind: Kind;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed' | 'superseded';
  result_id: string | null;
  cancel_requested: boolean;
  error: string | null;
  progress?: JobProgress | null;
  created_at?: string;
  updated_at?: string;
}
export const isActive = (job: Job) => job.state === 'queued' || job.state === 'running';
export interface JobOptions {
  task_prefix?: string;
  validation_id?: string;
  mode?: 'agent' | 'control';
  agents?: { label: string; model: string; max_turns: number; fallback_model?: string }[];
  repeats?: number;
}
export interface SavedExport {
  id: string;
  filename: string;
  sha256: string;
  validation_status_recorded: string;
}
export interface TaskDetail {
  task: TaskResponse;
  project_id: string | null;
  revision: number;
  snapshot: RepoAnalysisResponse | null;
  solution: SolutionResponse | null;
  test_suite: TestSuiteResponse | null;
  validation: ValidationReport | null;
  export: SavedExport | null;
  jobs: Job[];
}
export interface TaskList {
  tasks: TaskResponse[];
  states: { verdict: string | null; updated_at: string; project_id: string | null }[];
  total: number;
}
export interface Project {
  id: string;
  name: string;
  snapshot: RepoAnalysisResponse;
}
export interface HistoryItem {
  id: string;
  created_at: string;
  status: string | null;
  solution_id: string | null;
  suite_id: string | null;
}

