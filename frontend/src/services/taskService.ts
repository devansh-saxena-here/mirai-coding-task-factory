import { requestJson, requestMultipart } from './api';
import type { RepoAnalysisRequest, RepoAnalysisResponse } from '../types/repo';
import type { GenerateFromGithubRequest, GenerateFromRepoRequest, TaskRequest, TaskResponse } from '../types/task';

const post = <T,>(path: string, payload: object, signal?: AbortSignal) => requestJson<T>(path, {
  method: 'POST', body: JSON.stringify(payload), signal,
});

export const taskService = {
  checkHealth: () => requestJson<{ status: string }>('/health'),
  generateTopicTask: (payload: TaskRequest, signal?: AbortSignal) => post<TaskResponse>('/tasks/generate', payload, signal),
  analyzeGithub: (payload: RepoAnalysisRequest, signal?: AbortSignal) =>
    post<RepoAnalysisResponse>('/tasks/analyze/github', payload, signal),
  analyzeUpload: (file: File, signal?: AbortSignal) => {
    const data = new FormData();
    data.append('file', file);
    return requestMultipart<RepoAnalysisResponse>('/tasks/analyze/upload', data, signal);
  },
  generateTaskFromRepo: (payload: GenerateFromRepoRequest, signal?: AbortSignal) =>
    post<TaskResponse>('/tasks/generate/from-repo', payload, signal),
  generateTaskFromGithub: (payload: GenerateFromGithubRequest, signal?: AbortSignal) =>
    post<TaskResponse>('/tasks/generate/github', payload, signal),
};
