import { RepoAnalysisResponse } from './repo';
import { TaskResponse } from './task';
import { SolutionResponse } from './solution';
import { TestSuiteResponse } from './testSuite';
import { ValidationReport } from './validation';

export interface ApiError {
  message: string;
  statusCode?: number;
  detail?: string | Record<string, unknown>;
}

export type PipelineStep =
  | 'repository'
  | 'task'
  | 'solution'
  | 'test_suite'
  | 'validation'
  | 'export';

export interface ActiveProjectState {
  repoAnalysis: RepoAnalysisResponse | null;
  task: TaskResponse | null;
  solution: SolutionResponse | null;
  testSuite: TestSuiteResponse | null;
  validationReport: ValidationReport | null;
  currentStep: PipelineStep;
}
