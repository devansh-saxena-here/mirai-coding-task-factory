import 'dotenv/config';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  generateContextualTask,
  generateReferenceSolution,
  generateTestSuite,
  generateTopicTask,
  repairValidationArtifacts,
} from './server/gemini.ts';
import {
  buildHarborExport,
  evaluationSummaryCsv,
  evaluationTrialsCsv,
  runEvaluationCampaign,
  runValidationGates,
} from './server/harborBuilder.ts';
import { analyzeGitHubRepository, analyzeZipBuffer } from './server/repoAnalyzer.ts';
import {
  DEFAULT_GROQ_GPT_OSS_MODEL,
  DEFAULT_GROQ_QWEN_MODEL,
  isGroqConfigured,
} from './server/groq.ts';
import {
  DEFAULT_ADAPTION_LONG_CONTEXT_QWEN_MODEL,
  DEFAULT_ADAPTION_QWEN_MODEL,
  isAdaptionConfigured,
} from './server/adaption.ts';
import { verifyFirebaseIdToken } from './server/firebaseAuth.ts';
import type { VerifiedFirebaseUser } from './server/firebaseAuth.ts';
import { store } from './server/store.ts';
import type {
  EvaluationReport,
  JobOptions,
  JobProgressStep,
  Kind,
  RepoAnalysisResponse,
  ValidationReport,
} from './server/types.ts';

interface AuthedRequest extends Request {
  user?: VerifiedFirebaseUser;
}

const LEGACY_OWNER_EMAIL = (process.env.LEGACY_OWNER_EMAIL || '').trim().toLowerCase();

async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return res.status(401).json({ detail: 'Sign in with Google or GitHub to access your workspace.' });
  }
  try {
    const user = await verifyFirebaseIdToken(match[1].trim());
    if (LEGACY_OWNER_EMAIL && user.email && user.email.toLowerCase() === LEGACY_OWNER_EMAIL) {
      store.claimLegacyRecordsForOwner(user.uid);
    }
    req.user = user;
    return next();
  } catch (err) {
    return sendError(res, err);
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const FRONTEND_DIR = path.resolve(process.cwd(), 'frontend');
const FRONTEND_DIST = path.resolve(FRONTEND_DIR, 'dist');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function errorStatus(err: unknown): { status: number; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: number; status?: number; message?: string };
    let status = e.statusCode || e.status || 500;
    let message = e.message || 'Unexpected server error.';
    try {
      const parsed = JSON.parse(message) as { error?: { code?: number; message?: string } };
      if (parsed?.error) {
        if (typeof parsed.error.code === 'number') status = parsed.error.code;
        if (typeof parsed.error.message === 'string') message = parsed.error.message;
      }
    } catch {
      // Keep plain message
    }
    return { status: status >= 400 && status <= 599 ? status : 500, message };
  }
  return { status: 500, message: 'Unexpected server error.' };
}

function sendError(res: Response, err: unknown) {
  const { status, message } = errorStatus(err);
  return res.status(status).json({ detail: message });
}

function executeJobInBackground(jobId: string, options: JobOptions) {
  setImmediate(async () => {
    const job = store.jobs.get(jobId);
    if (!job || job.state === 'cancelled') return;
    store.updateJob(jobId, { state: 'running' });

    try {
      const detail = store.getTaskDetail(job.task_id);
      if (!detail) {
        throw Object.assign(new Error('Task was not found.'), { statusCode: 404 });
      }
      const snapRecord = detail.task.snapshot_id ? store.getSnapshot(detail.task.snapshot_id) : undefined;
      const snapshotFiles = snapRecord?.files ?? {};

      if (job.kind === 'solution') {
        const solution = await generateReferenceSolution({
          task: detail.task,
          files: snapshotFiles,
          existingTestFiles: snapRecord?.analysis.existing_test_files ?? [],
        });
        if (store.jobs.get(jobId)?.cancel_requested) {
          store.updateJob(jobId, { state: 'cancelled' });
          return;
        }
        store.saveArtifact(detail.task.id, 'solution', solution.id, solution, {
          status: solution.structural_check?.status || 'applied_to_snapshot',
          solution_id: solution.id,
        });
        store.updateJob(jobId, { state: 'completed', result_id: solution.id });
        return;
      }

      if (job.kind === 'tests') {
        const suite = await generateTestSuite({
          task: detail.task,
          solution: detail.solution,
          analysis: detail.snapshot,
          files: snapshotFiles,
        });
        if (store.jobs.get(jobId)?.cancel_requested) {
          store.updateJob(jobId, { state: 'cancelled' });
          return;
        }
        store.saveArtifact(detail.task.id, 'tests', suite.id, suite, {
          status: suite.quality_status || 'structurally_checked',
          suite_id: suite.id,
        });
        store.updateJob(jobId, { state: 'completed', result_id: suite.id });
        return;
      }

      if (job.kind === 'validation') {
        if (!detail.solution || !detail.test_suite) {
          throw Object.assign(new Error('Validation requires both a saved solution and test suite.'), {
            statusCode: 400,
          });
        }
        const report = runValidationGates({
          task: detail.task,
          solution: detail.solution,
          testSuite: detail.test_suite,
          snapshot: detail.snapshot,
          snapshotFiles,
        });
        store.saveArtifact(detail.task.id, 'validation', report.id, report, {
          status: report.overall_verdict,
          solution_id: detail.solution.id,
          suite_id: detail.test_suite.id,
        });
        store.updateJob(jobId, { state: 'completed', result_id: report.id });
        return;
      }

      if (job.kind === 'repair') {
        if (!detail.solution || !detail.test_suite) {
          throw Object.assign(new Error('Auto-repair requires a saved solution and test suite.'), {
            statusCode: 400,
          });
        }

        const sourceReport: ValidationReport | null =
          (options.validation_id
            ? (store.getArtifact('validation', options.validation_id)?.body as ValidationReport | undefined)
            : undefined) || detail.validation;

        if (!sourceReport) {
          throw Object.assign(new Error('Run validation at least once before triggering Auto-Repair.'), {
            statusCode: 400,
          });
        }

        const repairSteps: JobProgressStep[] = [
          { id: 'diagnose', label: 'Reading failing validation logs (stderr)', status: 'running', detail: null },
          { id: 'synthesize', label: 'Diagnosing & synthesizing AI repair with Gemini', status: 'pending', detail: null },
          { id: 'save', label: 'Saving repaired solution / test suite artifacts', status: 'pending', detail: null },
          { id: 'revalidate', label: 'Re-running 5 isolated validation gates', status: 'pending', detail: null },
        ];

        const emitRepair = (percent: number, stage: string, detailText?: string | null) => {
          const completed = repairSteps.filter((s) => s.status === 'completed').length;
          store.updateJob(jobId, {
            progress: {
              percent,
              completed_steps: completed,
              total_steps: repairSteps.length,
              stage,
              detail: detailText ?? null,
              steps: repairSteps.map((s) => ({ ...s })),
            },
          });
        };

        emitRepair(10, 'Reading failing validation logs', 'Inspecting stderr tracebacks and gate failure categories.');

        const gateLogs: Record<string, string> = {};
        const failedGateNames: string[] = [];
        for (const gate of sourceReport.gates || []) {
          if (gate.status !== 'passed') failedGateNames.push(gate.gate);
          const logParts: string[] = [];
          for (const run of gate.runs || []) {
            const filename = run.log_location?.split('/').pop();
            if (filename) {
              const content = store.getValidationLog(sourceReport.id, filename);
              if (content) logParts.push(content);
            }
          }
          if (logParts.length > 0) {
            gateLogs[gate.gate] = logParts.join('\n\n');
          }
        }

        repairSteps[0].status = 'completed';
        repairSteps[0].detail =
          failedGateNames.length > 0 ? `Failed: ${failedGateNames.join(', ')}` : 'Logs loaded';
        repairSteps[1].status = 'running';
        repairSteps[1].detail = 'Analyzing traceback & generating fix…';
        emitRepair(
          30,
          'Synthesizing targeted AI repair',
          `Gemini is diagnosing ${failedGateNames.join(', ') || 'validation'} failure(s) from stderr logs.`
        );

        const repaired = await repairValidationArtifacts({
          task: detail.task,
          solution: detail.solution,
          testSuite: detail.test_suite,
          analysis: detail.snapshot,
          snapshotFiles,
          validationReport: sourceReport,
          gateLogs,
        });

        if (store.jobs.get(jobId)?.cancel_requested) {
          store.updateJob(jobId, { state: 'cancelled' });
          return;
        }

        const targetLabel =
          repaired.repairedTarget === 'both'
            ? 'Solution & Tests'
            : repaired.repairedTarget === 'solution'
              ? 'Reference Solution'
              : 'Test Suite';

        repairSteps[1].status = 'completed';
        repairSteps[1].detail = `Target: ${targetLabel}`;
        repairSteps[2].status = 'running';
        repairSteps[2].detail = `Saving updated ${targetLabel.toLowerCase()}…`;
        emitRepair(68, `Applying repaired ${targetLabel}`, repaired.diagnosis);

        const nextSolution = repaired.repairedSolution || detail.solution;
        const nextTestSuite = repaired.repairedTestSuite || detail.test_suite;

        if (repaired.repairedSolution) {
          store.saveArtifact(detail.task.id, 'solution', repaired.repairedSolution.id, repaired.repairedSolution, {
            status: 'auto_repaired',
            solution_id: repaired.repairedSolution.id,
          });
        }
        if (repaired.repairedTestSuite) {
          store.saveArtifact(detail.task.id, 'tests', repaired.repairedTestSuite.id, repaired.repairedTestSuite, {
            status: 'auto_repaired',
            suite_id: repaired.repairedTestSuite.id,
          });
        }

        repairSteps[2].status = 'completed';
        repairSteps[2].detail = 'Artifacts saved';
        repairSteps[3].status = 'running';
        repairSteps[3].detail = 'Running 5 isolated gates…';
        emitRepair(82, 'Re-running 5 isolated validation gates', 'Verifying repaired artifacts against baseline, feature, regression, and negative control.');

        const revalidated = runValidationGates({
          task: detail.task,
          solution: nextSolution,
          testSuite: nextTestSuite,
          snapshot: detail.snapshot,
          snapshotFiles,
        });

        const enrichedReport: ValidationReport = {
          ...revalidated,
          auto_repair: {
            diagnosis: repaired.diagnosis,
            repaired_target: repaired.repairedTarget,
            source_validation_id: sourceReport.id,
            repaired_at: new Date().toISOString(),
          },
        };

        store.saveArtifact(detail.task.id, 'validation', enrichedReport.id, enrichedReport, {
          status: enrichedReport.overall_verdict,
          solution_id: nextSolution.id,
          suite_id: nextTestSuite.id,
        });

        repairSteps[3].status = enrichedReport.overall_verdict === 'VALIDATED' ? 'completed' : 'failed';
        repairSteps[3].detail = `Verdict: ${enrichedReport.overall_verdict}`;
        emitRepair(100, `Auto-repair finished (${enrichedReport.overall_verdict})`, repaired.diagnosis);

        store.updateJob(jobId, { state: 'completed', result_id: enrichedReport.id });
        return;
      }

      if (job.kind === 'export') {
        if (!detail.solution || !detail.test_suite) {
          throw Object.assign(new Error('Harbor export requires a saved solution and test suite.'), {
            statusCode: 400,
          });
        }
        const built = buildHarborExport({
          task: detail.task,
          solution: detail.solution,
          testSuite: detail.test_suite,
          validation: detail.validation,
          snapshot: detail.snapshot,
          snapshotFiles,
          taskPrefix: options.task_prefix,
        });
        store.saveExportArchive(built.meta.id, built.buffer, built.meta);
        store.saveArtifact(detail.task.id, 'export', built.meta.id, built.meta, {
          status: built.meta.validation_status_recorded,
          solution_id: detail.solution.id,
          suite_id: detail.test_suite.id,
        });
        store.updateJob(jobId, { state: 'completed', result_id: built.meta.id });
        return;
      }

      if (job.kind === 'evaluation') {
        if (!detail.snapshot || !detail.solution || !detail.test_suite) {
          throw Object.assign(
            new Error('Evaluation requires a snapshot-backed task with a validated solution and test suite.'),
            { statusCode: 400 }
          );
        }
        store.updateJob(jobId, {
          progress: {
            percent: 4,
            completed_steps: 0,
            total_steps: (options.mode === 'agent' ? (options.agents?.slice(0, 3).length || 0) * Math.max(1, Math.min(options.repeats || 1, 5)) : 0) + 3,
            stage: 'Initializing evaluation sandbox',
            detail: 'Preparing immutable repository snapshot and hidden verifier tests.',
          },
        });
        const report = await runEvaluationCampaign({
          task: detail.task,
          solution: detail.solution,
          testSuite: detail.test_suite,
          snapshot: detail.snapshot,
          snapshotFiles,
          savedExport: detail.export,
          options,
          onProgress: (progress) => {
            store.updateJob(jobId, { progress });
          },
          shouldCancel: () => Boolean(store.jobs.get(jobId)?.cancel_requested),
        });
        if (store.jobs.get(jobId)?.cancel_requested) {
          store.updateJob(jobId, { state: 'cancelled' });
          return;
        }
        store.saveArtifact(detail.task.id, 'evaluation', report.id, report, {
          status: report.state,
          solution_id: detail.solution.id,
          suite_id: detail.test_suite.id,
        });
        store.updateJob(jobId, { state: 'completed', result_id: report.id });
        return;
      }

      throw Object.assign(new Error(`Unsupported job kind: ${String(job.kind)}`), { statusCode: 400 });
    } catch (err) {
      if ((err as { cancelled?: boolean })?.cancelled || store.jobs.get(jobId)?.cancel_requested) {
        store.updateJob(jobId, { state: 'cancelled', error: null });
        return;
      }
      const { message } = errorStatus(err);
      store.updateJob(jobId, { state: 'failed', error: message });
    }
  });
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // ── Health & Auth ───────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  app.get('/auth/session', async (req: AuthedRequest, res) => {
    const authHeader = String(req.headers.authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      try {
        const user = await verifyFirebaseIdToken(match[1].trim());
        if (LEGACY_OWNER_EMAIL && user.email && user.email.toLowerCase() === LEGACY_OWNER_EMAIL) {
          store.claimLegacyRecordsForOwner(user.uid);
        }
        return res.json({ required: true, signed_in: true, user });
      } catch {
        return res.status(401).json({ detail: 'Invalid or expired session token.' });
      }
    }
    return res.json({ required: true, signed_in: false, providers: ['google', 'github'] });
  });

  app.post('/auth/session', requireUser, (req: AuthedRequest, res) => {
    return res.json({ signed_in: true, user: req.user });
  });

  app.delete('/auth/session', (_req, res) => {
    res.json({ signed_in: false });
  });

  app.get('/evaluation/providers', requireUser, (_req, res) => {
    const geminiModel = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim().replace(/^gemini\//i, '');
    res.json({
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        default_model: `gemini/${geminiModel || 'gemini-4-hydrogen'}`,
      },
      groq: {
        configured: isGroqConfigured(),
        default_models: {
          gpt_oss: DEFAULT_GROQ_GPT_OSS_MODEL,
          qwen: DEFAULT_GROQ_QWEN_MODEL,
        },
      },
      adaption: {
        configured: isAdaptionConfigured(),
        default_model: DEFAULT_ADAPTION_QWEN_MODEL,
        long_context_model: DEFAULT_ADAPTION_LONG_CONTEXT_QWEN_MODEL,
      },
    });
  });

  app.get('/evaluation/leaderboard', requireUser, (req: AuthedRequest, res) => {
    const rawScope = typeof req.query.scope === 'string' ? req.query.scope.trim() : 'latest_per_task';
    const scope = rawScope === 'all_runs' ? 'all_runs' : 'latest_per_task';
    const language = typeof req.query.language === 'string' && req.query.language.trim() ? req.query.language.trim() : undefined;
    const difficulty = typeof req.query.difficulty === 'string' && req.query.difficulty.trim() ? req.query.difficulty.trim() : undefined;
    const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : undefined;

    const leaderboard = store.getEvaluationLeaderboard(req.user!.uid, {
      scope,
      language,
      difficulty,
      category,
    });
    return res.json(leaderboard);
  });

  app.get('/evaluation/leaderboard.csv', requireUser, (req: AuthedRequest, res) => {
    const rawScope = typeof req.query.scope === 'string' ? req.query.scope.trim() : 'latest_per_task';
    const scope = rawScope === 'all_runs' ? 'all_runs' : 'latest_per_task';
    const language = typeof req.query.language === 'string' && req.query.language.trim() ? req.query.language.trim() : undefined;
    const difficulty = typeof req.query.difficulty === 'string' && req.query.difficulty.trim() ? req.query.difficulty.trim() : undefined;
    const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : undefined;

    const leaderboard = store.getEvaluationLeaderboard(req.user!.uid, {
      scope,
      language,
      difficulty,
      category,
    });
    const csv = store.formatLeaderboardCsv(leaderboard);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mirai-model-leaderboard.csv"');
    return res.send(csv);
  });

  // ── Projects & Snapshots (Per-User Scoped) ──────────────────────
  app.get('/projects', requireUser, (req: AuthedRequest, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    res.json({
      projects: store.listProjects(limit, offset, req.user!.uid),
      limit,
      offset,
    });
  });

  app.get('/snapshots/:snapshotId', requireUser, (req: AuthedRequest, res) => {
    const snap = store.getSnapshot(String(req.params.snapshotId), req.user!.uid);
    if (!snap) return res.status(404).json({ detail: 'The requested snapshot was not found.' });
    return res.json(snap.analysis);
  });

  // ── Tasks & Repository Analysis (Per-User Scoped) ───────────────
  app.get('/tasks', requireUser, (req: AuthedRequest, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    res.json(
      store.listTasks(
        {
          limit,
          offset,
          language: typeof req.query.language === 'string' ? req.query.language : undefined,
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          difficulty: typeof req.query.difficulty === 'string' ? req.query.difficulty : undefined,
          project_id: typeof req.query.project_id === 'string' ? req.query.project_id : undefined,
          q: typeof req.query.q === 'string' ? req.query.q : undefined,
        },
        req.user!.uid
      )
    );
  });

  app.post('/tasks/analyze/github', requireUser, async (req: AuthedRequest, res) => {
    try {
      const repoUrl = String(req.body?.repo_url || '').trim();
      const commitSha = typeof req.body?.commit_sha === 'string' ? req.body.commit_sha.trim() : undefined;
      if (!repoUrl) {
        return res.status(400).json({ detail: 'repo_url is required.' });
      }
      const { analysis, files } = await analyzeGitHubRepository(repoUrl, commitSha);
      const saved = store.saveSnapshot(analysis, files, req.user!.uid);
      return res.status(200).json(saved);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/tasks/analyze/upload', requireUser, upload.single('file'), (req: AuthedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ detail: 'A .zip archive file is required.' });
      }
      const filename = req.file.originalname || 'upload.zip';
      if (!filename.toLowerCase().endsWith('.zip')) {
        return res.status(400).json({ detail: 'Only .zip archive uploads are supported.' });
      }
      const { analysis, files } = analyzeZipBuffer(req.file.buffer, filename);
      const saved = store.saveSnapshot(analysis, files, req.user!.uid);
      return res.status(200).json(saved);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/tasks/generate', requireUser, async (req: AuthedRequest, res) => {
    try {
      const topic = String(req.body?.topic || '').trim();
      if (!topic) return res.status(400).json({ detail: 'topic is required.' });
      const task = await generateTopicTask({
        topic,
        difficulty: req.body?.difficulty,
        language: req.body?.language,
        category: req.body?.category,
      });
      return res.status(201).json(store.saveTask(task, req.user!.uid));
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/tasks/generate/from-repo', requireUser, async (req: AuthedRequest, res) => {
    try {
      const ownerId = req.user!.uid;
      const bodyAnalysis = req.body?.repo_analysis as RepoAnalysisResponse | undefined;
      const snapshotId =
        typeof req.body?.snapshot_id === 'string' && req.body.snapshot_id.trim()
          ? req.body.snapshot_id.trim()
          : typeof bodyAnalysis?.snapshot_id === 'string' && bodyAnalysis.snapshot_id.trim()
            ? bodyAnalysis.snapshot_id.trim()
            : undefined;

      let snap = snapshotId ? store.getSnapshot(snapshotId, ownerId) : undefined;
      let analysis: RepoAnalysisResponse | undefined = snap?.analysis;
      let files: Record<string, string> = snap?.files ?? {};

      if (!snap && bodyAnalysis) {
        // Attempt to re-hydrate source files from GitHub when repository identity is available
        if (
          bodyAnalysis.source_type === 'github' &&
          typeof bodyAnalysis.repository_identity === 'string' &&
          bodyAnalysis.repository_identity.startsWith('https://github.com/')
        ) {
          const [repoUrl, identitySha] = bodyAnalysis.repository_identity.split('@');
          try {
            const recovered = await analyzeGitHubRepository(
              repoUrl,
              bodyAnalysis.commit_sha || identitySha || undefined
            );
            const preservedAnalysis: RepoAnalysisResponse = {
              ...recovered.analysis,
              snapshot_id: snapshotId || recovered.analysis.snapshot_id,
            };
            analysis = store.saveSnapshot(preservedAnalysis, recovered.files, ownerId);
            files = recovered.files;
          } catch {
            // Fall back to registering submitted metadata so contextual generation still succeeds
          }
        }

        if (!analysis) {
          analysis = store.saveSnapshot(
            {
              ...bodyAnalysis,
              snapshot_id: snapshotId || bodyAnalysis.snapshot_id,
            },
            {},
            ownerId
          );
          files = {};
        }
      }

      if (!analysis) {
        return res.status(404).json({
          detail: 'The source snapshot was not found. Please re-analyze the repository in New Project.',
        });
      }

      const options = req.body?.options || {};
      const task = await generateContextualTask({
        analysis,
        files,
        difficulty: options.difficulty,
        focus_area: options.focus_area,
        category: options.category,
      });
      return res.status(201).json(store.saveTask(task, ownerId));
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/tasks/generate/github', requireUser, async (req: AuthedRequest, res) => {
    try {
      const ownerId = req.user!.uid;
      const repoUrl = String(req.body?.repo_url || '').trim();
      if (!repoUrl) return res.status(400).json({ detail: 'repo_url is required.' });
      const { analysis, files } = await analyzeGitHubRepository(repoUrl);
      const saved = store.saveSnapshot(analysis, files, ownerId);
      const options = req.body?.options || {};
      const task = await generateContextualTask({
        analysis: saved,
        files,
        difficulty: options.difficulty,
        focus_area: options.focus_area,
        category: options.category,
      });
      return res.status(201).json(store.saveTask(task, ownerId));
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/tasks/restore', requireUser, async (req: AuthedRequest, res) => {
    try {
      const ownerId = req.user!.uid;
      const incomingTask = req.body?.task as Partial<{
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
        project_name: string | null;
        relevant_files: string[];
        snapshot_id: string | null;
        starting_commit_sha: string | null;
      }> | undefined;

      const taskId = String(incomingTask?.id || '').trim();
      const title = String(incomingTask?.title || '').trim();
      if (!taskId || !title) {
        return res.status(400).json({ detail: 'task.id and task.title are required to restore a saved task.' });
      }

      const existing = store.tasks.get(taskId);
      if (existing) {
        if (existing.owner_id && existing.owner_id !== ownerId) {
          return res.status(403).json({ detail: 'This task belongs to another user account.' });
        }
        return res.status(200).json(existing.task);
      }

      const snapshotId =
        typeof incomingTask?.snapshot_id === 'string' && incomingTask.snapshot_id.trim()
          ? incomingTask.snapshot_id.trim()
          : null;

      const projectMeta = req.body?.project as Partial<{
        source_type: string;
        repository_identity: string;
        commit_sha: string;
        project_name: string;
      }> | undefined;

      if (snapshotId && !store.getSnapshot(snapshotId, ownerId)) {
        const identity = String(projectMeta?.repository_identity || '').trim();
        if (projectMeta?.source_type === 'github' && identity.startsWith('https://github.com/')) {
          const [repoUrl, identitySha] = identity.split('@');
          const commitSha = String(projectMeta?.commit_sha || identitySha || '').trim() || undefined;
          try {
            const recovered = await analyzeGitHubRepository(repoUrl, commitSha);
            store.saveSnapshot(
              {
                ...recovered.analysis,
                snapshot_id: snapshotId,
              },
              recovered.files,
              ownerId
            );
          } catch {
            // Proceed restoring the task even if GitHub is temporarily unreachable
          }
        }
      }

      const restored = store.saveTask(
        {
          id: taskId,
          topic: String(incomingTask?.topic || title),
          difficulty: String(incomingTask?.difficulty || 'medium'),
          language: String(incomingTask?.language || 'Unknown'),
          category: String(incomingTask?.category || 'backend'),
          title,
          description:
            String(incomingTask?.description || '').trim() ||
            `Restored from Firebase Cloud history for "${title}".`,
          requirements: Array.isArray(incomingTask?.requirements)
            ? incomingTask.requirements.filter((x): x is string => typeof x === 'string')
            : [],
          acceptance_criteria: Array.isArray(incomingTask?.acceptance_criteria)
            ? incomingTask.acceptance_criteria.filter((x): x is string => typeof x === 'string')
            : [],
          generated_at: String(incomingTask?.generated_at || new Date().toISOString()),
          project_name: incomingTask?.project_name ?? projectMeta?.project_name ?? null,
          relevant_files: Array.isArray(incomingTask?.relevant_files)
            ? incomingTask.relevant_files.filter((x): x is string => typeof x === 'string')
            : [],
          snapshot_id: snapshotId,
          starting_commit_sha: incomingTask?.starting_commit_sha ?? projectMeta?.commit_sha ?? null,
        },
        ownerId
      );

      return res.status(200).json(restored);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/tasks/:taskId', requireUser, (req: AuthedRequest, res) => {
    const detail = store.getTaskDetail(String(req.params.taskId), req.user!.uid);
    if (!detail) return res.status(404).json({ detail: 'The requested task was not found.' });
    return res.json(detail);
  });

  // ── Workflow Jobs (Per-User Scoped) ─────────────────────────────
  app.post('/tasks/:taskId/jobs', requireUser, (req: AuthedRequest, res) => {
    try {
      const ownerId = req.user!.uid;
      const taskId = String(req.params.taskId);
      const kind = req.body?.kind as Kind;
      const revision = Number(req.body?.revision);
      const requestKey = typeof req.body?.request_key === 'string' ? req.body.request_key : undefined;
      const options: JobOptions = {
        task_prefix: req.body?.task_prefix,
        validation_id: typeof req.body?.validation_id === 'string' ? req.body.validation_id : undefined,
        mode: req.body?.mode,
        agents: req.body?.agents,
        repeats: req.body?.repeats,
      };
      const { job, deduplicated } = store.enqueueJob(taskId, kind, revision, requestKey, ownerId);
      res.setHeader('Location', `/jobs/${job.id}`);
      if (!deduplicated && job.state === 'queued') {
        executeJobInBackground(job.id, options);
      }
      return res.status(202).json(job);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/jobs/:jobId', requireUser, (req: AuthedRequest, res) => {
    const job = store.getJob(String(req.params.jobId), req.user!.uid);
    if (!job) return res.status(404).json({ detail: 'The requested job was not found.' });
    return res.json(job);
  });

  app.delete('/jobs/:jobId', requireUser, (req: AuthedRequest, res) => {
    const job = store.getJob(String(req.params.jobId), req.user!.uid);
    if (!job) return res.status(404).json({ detail: 'The requested job was not found.' });
    if (job.state === 'queued' || job.state === 'running') {
      store.updateJob(job.id, { cancel_requested: true, state: 'cancelled' });
    }
    return res.json(job);
  });

  // ── History, Artifacts, Logs, Downloads (Per-User Scoped) ───────
  app.get('/tasks/:taskId/history/:kind', requireUser, (req: AuthedRequest, res) => {
    const ownerId = req.user!.uid;
    const taskId = String(req.params.taskId);
    const kind = String(req.params.kind) as Kind;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const taskRec = store.tasks.get(taskId);
    if (!taskRec || taskRec.owner_id !== ownerId) {
      return res.status(404).json({ detail: 'The requested task was not found.' });
    }
    return res.json({
      items: store.getHistory(taskId, kind, limit, offset, ownerId),
      limit,
      offset,
    });
  });

  app.get('/history/export/:recordId/download', requireUser, (req: AuthedRequest, res) => {
    const recordId = String(req.params.recordId);
    const archive = store.getExportArchive(recordId, req.user!.uid);
    if (!archive) {
      return res.status(404).json({ detail: 'The requested package was not found.' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.meta.filename}"`);
    res.setHeader('X-Harbor-Task-Name', archive.meta.harbor_task_name);
    res.setHeader('X-Validation-Status', archive.meta.validation_status_recorded);
    return res.send(archive.buffer);
  });

  app.get('/history/validation/:recordId/logs/:name', requireUser, (req: AuthedRequest, res) => {
    const log = store.getValidationLog(String(req.params.recordId), String(req.params.name), req.user!.uid);
    if (log === undefined) {
      return res.status(404).json({ detail: 'The requested log was not found.' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(log);
  });

  app.get('/history/evaluation/:recordId/logs/:name', requireUser, (req: AuthedRequest, res) => {
    const log = store.getEvaluationLog(String(req.params.recordId), String(req.params.name), req.user!.uid);
    if (log === undefined) {
      return res.status(404).json({ detail: 'The requested log was not found.' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(log);
  });

  app.get('/history/evaluation/:recordId/:formatName', requireUser, (req: AuthedRequest, res) => {
    const recordId = String(req.params.recordId);
    const formatName = String(req.params.formatName);
    if (formatName !== 'summary.csv' && formatName !== 'trials.csv') {
      return res.status(404).json({ detail: 'Unsupported export format.' });
    }
    const artifact = store.getArtifact('evaluation', recordId, req.user!.uid);
    if (!artifact) return res.status(404).json({ detail: 'The requested evaluation was not found.' });
    const report = artifact.body as EvaluationReport;
    const csv = formatName === 'summary.csv' ? evaluationSummaryCsv(report) : evaluationTrialsCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${formatName}"`);
    return res.send(csv);
  });

  app.get('/history/:kind/:recordId', requireUser, (req: AuthedRequest, res) => {
    const kind = String(req.params.kind) as Kind;
    const recordId = String(req.params.recordId);
    const artifact = store.getArtifact(kind, recordId, req.user!.uid);
    if (!artifact) return res.status(404).json({ detail: 'The requested record was not found.' });
    return res.json(artifact.body);
  });

  // ── Frontend Serving (Built SPA from frontend/dist) ─────────────
  const indexHtml = path.join(FRONTEND_DIST, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.log('frontend/dist not found — building frontend...');
    execSync('npm --workspace=frontend run build', { stdio: 'inherit' });
  }

  app.use(express.static(FRONTEND_DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.sendFile(indexHtml);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    return sendError(res, err);
  });

  app.listen(PORT, HOST, () => {
    console.log(`MIRAI server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MIRAI server:', err);
  process.exit(1);
});
