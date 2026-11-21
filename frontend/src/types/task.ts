import { RepoAnalysisResponse } from './repo';

export type TaskDifficulty = 'easy' | 'medium' | 'hard';
export type TaskCategory = 'backend' | 'frontend' | 'fullstack' | 'devops' | 'data';

export interface TaskRequest {
  topic: string;
  difficulty?: string;
  language?: string;
  category?: string;
}

export interface RepoTaskRequest {
  difficulty?: TaskDifficulty;
  focus_area?: string | null;
  category?: string | null;
}

export interface GenerateFromRepoRequest {
  repo_analysis?: RepoAnalysisResponse;
  snapshot_id?: string;
  options?: RepoTaskRequest;
}

export interface GenerateFromGithubRequest {
  repo_url: string;
  options?: RepoTaskRequest;
}

export interface TaskResponse {
  id: string;
  topic: string;
  difficulty: string;
  language: string;
  category: string;
  title: string;
  description: string;
  requirements: string[];
  acceptance_criteria: string[];
  generated_at: string;
  project_name?: string | null;
  relevant_files: string[];
  snapshot_id?: string | null;
  starting_commit_sha?: string | null;
}


