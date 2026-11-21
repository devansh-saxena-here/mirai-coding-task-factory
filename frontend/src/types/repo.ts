export interface RepoAnalysisRequest {
  repo_url: string;
  commit_sha?: string;
}

export interface RepoAnalysisResponse {
  project_name: string;
  source_type: 'github' | 'zip';
  detected_languages: string[];
  detected_frameworks: string[];
  file_count: number;
  folder_structure: string[];
  readme_summary: string | null;
  analysis_status: 'pending' | 'completed' | 'failed';
  commit_sha: string | null;
  snapshot_id: string | null;
  content_sha256: string | null;
  repository_identity: string | null;
  retrieved_at: string | null;
  test_frameworks: string[];
  existing_test_files: string[];
  baseline_test_commands: { framework: string; working_directory: string; argv: string[] }[];
}

