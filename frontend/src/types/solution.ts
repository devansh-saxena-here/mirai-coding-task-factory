import { TaskResponse } from './task';

export type FileStatus = 'create' | 'modify' | 'delete';

export interface SolutionFile {
  path: string;
  status: FileStatus;
  language: string;
  code: string;
  explanation: string;
  requirement_ids?: string[];
  acceptance_criteria_ids?: string[];
  base_sha256?: string | null;
  result_sha256?: string | null;
}

export interface SolutionRequest {
  task: TaskResponse;
  authorized_deletions?: string[];
}

export interface SolutionResponse {
  id: string;
  task_id: string;
  task_title: string;
  snapshot_id?: string | null;
  context_files?: Array<{ path: string; kind: 'source' | 'test' | 'config' | 'readme'; complete: boolean }>;
  requirements?: Array<{ id: string; text: string }>;
  acceptance_criteria?: Array<{ id: string; text: string }>;
  structural_check?: {
    status: 'applied_to_snapshot' | 'not_checked';
    execution_status: 'not_run';
    model_attempts: number;
    input_bytes: number;
    estimated_input_tokens: number;
  } | null;
  architecture_notes: string;
  files: SolutionFile[];
  testing_guide: string;
  verification_steps: string[];
  generated_at: string;
}
