import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { DiskBackedWorkflowStore } from '../server/store.ts';
import { makeRate } from '../server/testBreakdown.ts';
import type { EvaluationReport, RepoAnalysisResponse, TaskResponse } from '../server/types.ts';

describe('DiskBackedWorkflowStore isolation & leaderboard aggregation', () => {
  const tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirai-store-test-'));

  after(() => {
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  it('enforces owner-scoped isolation across snapshots, tasks, and artifacts', () => {
    const testStore = new DiskBackedWorkflowStore(tempStateDir);

    const snapshot: RepoAnalysisResponse = {
      project_name: 'alpha-service',
      source_type: 'zip',
      detected_languages: ['Python'],
      detected_frameworks: ['FastAPI'],
      file_count: 1,
      folder_structure: ['app.py'],
      readme_summary: null,
      analysis_status: 'completed',
      commit_sha: null,
      snapshot_id: 'snap_alpha_1',
      content_sha256: 'hash_alpha_1',
      repository_identity: 'zip:alpha-service',
      retrieved_at: '2026-01-01T00:00:00.000Z',
      test_frameworks: ['pytest'],
      existing_test_files: [],
      baseline_test_commands: [],
    };

    const savedSnap = testStore.saveSnapshot(snapshot, { 'app.py': 'x = 1' }, 'user-a');
    assert.ok(testStore.getSnapshot(savedSnap.snapshot_id!, 'user-a'));
    assert.equal(testStore.getSnapshot(savedSnap.snapshot_id!, 'user-b'), undefined);

    const task: TaskResponse = {
      id: 'task-alpha-1',
      title: 'Add health route',
      topic: 'API',
      difficulty: 'medium',
      category: 'feature',
      description: 'Add GET /health',
      requirements: ['Return 200'],
      acceptance_criteria: ['JSON payload'],
      relevant_files: ['app.py'],
      language: 'Python',
      project_name: 'alpha-service',
      snapshot_id: savedSnap.snapshot_id,
      generated_at: '2026-01-01T00:00:00.000Z',
    };
    testStore.saveTask(task, 'user-a');

    assert.ok(testStore.getTaskDetail(task.id, 'user-a'));
    assert.equal(testStore.getTaskDetail(task.id, 'user-b'), null);
    assert.equal(testStore.listProjects(10, 0, 'user-a').length, 1);
    assert.equal(testStore.listProjects(10, 0, 'user-b').length, 0);
  });

  it('aggregates evaluation leaderboard rankings, partial scores, and CSV output', () => {
    const testStore = new DiskBackedWorkflowStore(tempStateDir);
    const taskId = 'task-alpha-1';

    const report: EvaluationReport = {
      id: 'eval-lb-1',
      task_id: taskId,
      mode: 'agent',
      state: 'completed',
      detail: 'Completed',
      failure: null,
      harbor_version: '1.4',
      docker_engine: null,
      package: {
        snapshot_id: 'snap_alpha_1',
        snapshot_sha256: 'hash_alpha_1',
        starting_commit_sha: null,
        solution_sha256: 'sol_sha',
        test_suite_sha256: 'suite_sha',
        package_sha256: 'pkg_sha',
        runtime_image: 'python:3.11-slim',
        difficulty: 'medium',
        category: 'feature',
        language: 'Python',
      },
      oracle: null,
      baseline_control: null,
      trials: [],
      metrics: [
        {
          label: 'gemini',
          model: 'gemini/gemini-2.5-flash',
          scheduled: 2,
          scored: 2,
          verified_success: makeRate(2, 2),
          feature_pass: makeRate(2, 2),
          regression_pass: makeRate(2, 2),
          build_success: makeRate(2, 2),
          mean_partial_score: 1,
          feature_cases_passed: 6,
          feature_cases_total: 6,
          regression_cases_passed: 4,
          regression_cases_total: 4,
          mean_agent_seconds: 3.2,
          sample_agent_seconds_sd: 0.1,
          input_tokens_total: 2000,
          output_tokens_total: 500,
          cost_usd_total: null,
          failure_counts: {},
        },
        {
          label: 'gpt-oss-120b',
          model: 'groq/openai/gpt-oss-120b',
          scheduled: 2,
          scored: 2,
          verified_success: makeRate(1, 2),
          feature_pass: makeRate(1, 2),
          regression_pass: makeRate(2, 2),
          build_success: makeRate(2, 2),
          mean_partial_score: 0.75,
          feature_cases_passed: 4,
          feature_cases_total: 6,
          regression_cases_passed: 4,
          regression_cases_total: 4,
          mean_agent_seconds: 2.1,
          sample_agent_seconds_sd: 0.2,
          input_tokens_total: 1800,
          output_tokens_total: 400,
          cost_usd_total: null,
          failure_counts: { feature_tests_failed: 1 },
        },
      ],
    };

    testStore.saveArtifact(taskId, 'evaluation', report.id, report, { status: 'DISCRIMINATIVE' });

    const lb = testStore.getEvaluationLeaderboard('user-a', { scope: 'latest_per_task' });
    assert.equal(lb.summary.tasks_evaluated, 1);
    assert.equal(lb.summary.total_trials_scored, 4);
    assert.equal(lb.summary.total_trials_passed, 3);
    assert.equal(lb.models.length, 2);
    assert.equal(lb.models[0].provider, 'gemini');
    assert.equal(lb.models[0].verified_success.value, 1);
    assert.equal(lb.models[1].provider, 'groq');
    assert.equal(lb.models[1].mean_partial_score, 0.75);
    assert.equal(lb.summary.fastest_model?.display_name, 'GPT-OSS 120B');

    // Other users should see an empty leaderboard
    const otherLb = testStore.getEvaluationLeaderboard('user-b');
    assert.equal(otherLb.models.length, 0);

    const csv = testStore.formatLeaderboardCsv(lb);
    assert.match(csv, /^rank,display_name,model_id/);
    assert.match(csv, /GPT-OSS 120B/);
    assert.match(csv, /75\.0%/);
  });
});
