import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  EvaluationReport,
  HistoryItem,
  Job,
  Kind,
  LeaderboardFailureBucket,
  LeaderboardModelEntry,
  LeaderboardResponse,
  LeaderboardScope,
  LeaderboardTaskModelCell,
  LeaderboardTaskRow,
  Rate,
  RepoAnalysisResponse,
  SavedExport,
  SnapshotRecord,
  SolutionResponse,
  TaskResponse,
  TestSuiteResponse,
  ValidationReport,
} from './types.ts';

export interface ProjectRecord {
  id: string;
  name: string;
  owner_id?: string | null;
  snapshot: RepoAnalysisResponse;
  created_at: string;
}

export interface ArtifactRecord {
  id: string;
  task_id: string;
  owner_id?: string | null;
  kind: Kind;
  body: unknown;
  status: string | null;
  solution_id: string | null;
  suite_id: string | null;
  created_at: string;
}

export interface TaskRecord {
  task: TaskResponse;
  owner_id?: string | null;
  project_id: string | null;
  revision: number;
  solution_id: string | null;
  suite_id: string | null;
  validation_id: string | null;
  export_id: string | null;
  updated_at: string;
}

interface PersistedState {
  snapshots: Array<[string, SnapshotRecord]>;
  projects: Array<[string, ProjectRecord]>;
  tasks: Array<[string, TaskRecord]>;
  artifacts: Array<[string, ArtifactRecord]>;
  jobs: Array<[string, Job]>;
  validationLogs: Array<[string, string]>;
  evaluationLogs: Array<[string, string]>;
  exportMetas: Array<[string, SavedExport]>;
}

export function sha256Hex(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

class DiskBackedWorkflowStore {
  private readonly stateDir: string;
  private readonly stateFile: string;
  private readonly exportsDir: string;

  snapshots = new Map<string, SnapshotRecord>();
  projects = new Map<string, ProjectRecord>();
  tasks = new Map<string, TaskRecord>();
  artifacts = new Map<string, ArtifactRecord>();
  jobs = new Map<string, Job>();
  requestKeys = new Map<string, string>();
  exportArchives = new Map<string, { buffer: Buffer; meta: SavedExport }>();
  validationLogs = new Map<string, string>();
  evaluationLogs = new Map<string, string>();

  constructor() {
    this.stateDir = path.resolve(process.env.CTF_STATE_DIR?.trim() || path.join(process.cwd(), '.mirai-state'));
    this.stateFile = path.join(this.stateDir, 'state.json');
    this.exportsDir = path.join(this.stateDir, 'exports');
    this.hydrate();
  }

  private hydrate() {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const data = JSON.parse(raw) as Partial<PersistedState>;

      if (Array.isArray(data.snapshots)) {
        for (const [k, v] of data.snapshots) this.snapshots.set(k, v);
      }
      if (Array.isArray(data.projects)) {
        for (const [k, v] of data.projects) this.projects.set(k, v);
      }
      if (Array.isArray(data.tasks)) {
        for (const [k, v] of data.tasks) this.tasks.set(k, v);
      }
      if (Array.isArray(data.artifacts)) {
        for (const [k, v] of data.artifacts) this.artifacts.set(k, v);
      }
      if (Array.isArray(data.jobs)) {
        for (const [k, v] of data.jobs) {
          if (v.state === 'queued' || v.state === 'running') {
            v.state = 'interrupted';
            v.error = v.error || 'Server restarted while job was in progress.';
          }
          this.jobs.set(k, v);
        }
      }
      if (Array.isArray(data.validationLogs)) {
        for (const [k, v] of data.validationLogs) this.validationLogs.set(k, v);
      }
      if (Array.isArray(data.evaluationLogs)) {
        for (const [k, v] of data.evaluationLogs) this.evaluationLogs.set(k, v);
      }
      if (Array.isArray(data.exportMetas)) {
        for (const [id, meta] of data.exportMetas) {
          const zipPath = path.join(this.exportsDir, `${id}.zip`);
          if (fs.existsSync(zipPath)) {
            this.exportArchives.set(id, { buffer: fs.readFileSync(zipPath), meta });
          }
        }
      }
    } catch (err) {
      console.warn('[MIRAI Store] Could not hydrate persisted state:', err);
    }
  }

  private persist() {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const payload: PersistedState = {
        snapshots: Array.from(this.snapshots.entries()),
        projects: Array.from(this.projects.entries()),
        tasks: Array.from(this.tasks.entries()),
        artifacts: Array.from(this.artifacts.entries()),
        jobs: Array.from(this.jobs.entries()),
        validationLogs: Array.from(this.validationLogs.entries()),
        evaluationLogs: Array.from(this.evaluationLogs.entries()),
        exportMetas: Array.from(this.exportArchives.entries()).map(([id, entry]) => [id, entry.meta]),
      };
      const tmpFile = `${this.stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmpFile, this.stateFile);
    } catch (err) {
      console.warn('[MIRAI Store] Could not persist state to disk:', err);
    }
  }

  /**
   * Assign pre-authentication legacy records (owner_id == null) to a verified user once
   * so existing workspace progress is preserved under their account ID.
   */
  claimLegacyRecordsForOwner(ownerId: string): boolean {
    let changed = false;
    for (const snap of this.snapshots.values()) {
      if (!snap.owner_id) {
        snap.owner_id = ownerId;
        changed = true;
      }
    }
    for (const proj of this.projects.values()) {
      if (!proj.owner_id) {
        proj.owner_id = ownerId;
        changed = true;
      }
    }
    for (const rec of this.tasks.values()) {
      if (!rec.owner_id) {
        rec.owner_id = ownerId;
        changed = true;
      }
    }
    for (const art of this.artifacts.values()) {
      if (!art.owner_id) {
        art.owner_id = ownerId;
        changed = true;
      }
    }
    for (const job of this.jobs.values()) {
      if (!job.owner_id) {
        job.owner_id = ownerId;
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  saveSnapshot(
    analysis: RepoAnalysisResponse,
    files: Record<string, string>,
    ownerId: string
  ): RepoAnalysisResponse {
    const contentSha = analysis.content_sha256 || sha256Hex(JSON.stringify(files));
    const existingSnap = analysis.snapshot_id ? this.snapshots.get(analysis.snapshot_id) : undefined;
    const canReuseId =
      Boolean(analysis.snapshot_id) && (!existingSnap || existingSnap.owner_id === ownerId);
    const snapshotId = canReuseId
      ? (analysis.snapshot_id as string)
      : `snap_${sha256Hex(`${ownerId}:${contentSha}`).slice(0, 16)}`;

    const normalized: RepoAnalysisResponse = {
      ...analysis,
      snapshot_id: snapshotId,
      content_sha256: contentSha,
      retrieved_at: analysis.retrieved_at || new Date().toISOString(),
      analysis_status: 'completed',
    };

    const projectId = `proj_${sha256Hex(`${ownerId}:${normalized.repository_identity || normalized.project_name}`).slice(0, 12)}`;
    this.snapshots.set(snapshotId, { analysis: normalized, files, projectId, owner_id: ownerId });
    this.projects.set(projectId, {
      id: projectId,
      name: normalized.project_name,
      owner_id: ownerId,
      snapshot: normalized,
      created_at: normalized.retrieved_at || new Date().toISOString(),
    });
    this.persist();

    return normalized;
  }

  getSnapshot(snapshotId: string, ownerId?: string): SnapshotRecord | undefined {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return undefined;
    if (ownerId && snap.owner_id !== ownerId) return undefined;
    return snap;
  }

  listProjects(limit: number, offset: number, ownerId: string): ProjectRecord[] {
    const items = Array.from(this.projects.values())
      .filter((p) => p.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return items.slice(offset, offset + limit);
  }

  saveTask(task: TaskResponse, ownerId: string): TaskResponse {
    const snap = task.snapshot_id ? this.getSnapshot(task.snapshot_id, ownerId) : undefined;
    const projectId = snap?.projectId ?? null;
    const existing = this.tasks.get(task.id);
    const now = new Date().toISOString();
    this.tasks.set(task.id, {
      task,
      owner_id: ownerId,
      project_id: projectId,
      revision: existing ? existing.revision + 1 : 1,
      solution_id: existing?.solution_id ?? null,
      suite_id: existing?.suite_id ?? null,
      validation_id: existing?.validation_id ?? null,
      export_id: existing?.export_id ?? null,
      updated_at: now,
    });
    this.persist();
    return task;
  }

  listTasks(
    filters: {
      limit: number;
      offset: number;
      language?: string;
      category?: string;
      difficulty?: string;
      project_id?: string;
      q?: string;
    },
    ownerId: string
  ) {
    let entries = Array.from(this.tasks.values())
      .filter((e) => e.owner_id === ownerId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    if (filters.language) {
      const lang = filters.language.toLowerCase();
      entries = entries.filter((e) => e.task.language.toLowerCase() === lang);
    }
    if (filters.category) {
      const cat = filters.category.toLowerCase();
      entries = entries.filter((e) => e.task.category.toLowerCase() === cat);
    }
    if (filters.difficulty) {
      const diff = filters.difficulty.toLowerCase();
      entries = entries.filter((e) => e.task.difficulty.toLowerCase() === diff);
    }
    if (filters.project_id) {
      entries = entries.filter((e) => e.project_id === filters.project_id);
    }
    if (filters.q) {
      const query = filters.q.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.task.title.toLowerCase().includes(query) ||
          e.task.topic.toLowerCase().includes(query) ||
          (e.task.project_name || '').toLowerCase().includes(query)
      );
    }

    const total = entries.length;
    const page = entries.slice(filters.offset, filters.offset + filters.limit);

    return {
      tasks: page.map((e) => e.task),
      states: page.map((e) => {
        const valArtifact = e.validation_id ? this.artifacts.get(e.validation_id) : undefined;
        const verdict = valArtifact ? (valArtifact.body as ValidationReport).overall_verdict : null;
        return {
          verdict,
          updated_at: e.updated_at,
          project_id: e.project_id,
        };
      }),
      total,
    };
  }

  getTaskDetail(taskId: string, ownerId?: string) {
    const rec = this.tasks.get(taskId);
    if (!rec) return null;
    if (ownerId && rec.owner_id !== ownerId) return null;
    const snap = rec.task.snapshot_id ? this.snapshots.get(rec.task.snapshot_id)?.analysis ?? null : null;
    const solution = rec.solution_id
      ? ((this.artifacts.get(rec.solution_id)?.body as SolutionResponse) ?? null)
      : null;
    const testSuite = rec.suite_id
      ? ((this.artifacts.get(rec.suite_id)?.body as TestSuiteResponse) ?? null)
      : null;
    const validation = rec.validation_id
      ? ((this.artifacts.get(rec.validation_id)?.body as ValidationReport) ?? null)
      : null;
    const savedExport = rec.export_id
      ? ((this.artifacts.get(rec.export_id)?.body as SavedExport) ?? null)
      : null;
    const jobs = Array.from(this.jobs.values())
      .filter((j) => j.task_id === taskId && (!ownerId || j.owner_id === ownerId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10);

    return {
      task: rec.task,
      project_id: rec.project_id,
      revision: rec.revision,
      snapshot: snap,
      solution,
      test_suite: testSuite,
      validation,
      export: savedExport,
      jobs,
    };
  }

  getJob(jobId: string, ownerId?: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (ownerId && job.owner_id !== ownerId) return undefined;
    return job;
  }

  enqueueJob(
    taskId: string,
    kind: Kind,
    revision: number,
    requestKey: string | undefined,
    ownerId: string
  ): { job: Job; deduplicated: boolean } {
    const rec = this.tasks.get(taskId);
    if (!rec || rec.owner_id !== ownerId) {
      throw Object.assign(new Error('The requested task was not found.'), { statusCode: 404 });
    }
    if (requestKey) {
      const existingId = this.requestKeys.get(`${ownerId}:${taskId}:${requestKey}`);
      if (existingId) {
        const existingJob = this.jobs.get(existingId);
        if (existingJob) return { job: existingJob, deduplicated: true };
      }
    }
    if (rec.revision !== revision) {
      throw Object.assign(
        new Error('Task revision is stale. Reload the latest task state and retry.'),
        { statusCode: 409 }
      );
    }

    const active = Array.from(this.jobs.values()).find(
      (j) => j.task_id === taskId && j.owner_id === ownerId && (j.state === 'queued' || j.state === 'running')
    );
    if (active) {
      throw Object.assign(new Error('Another workflow job is already active for this task.'), {
        statusCode: 409,
      });
    }

    const now = new Date().toISOString();
    const job: Job = {
      id: randomHex(16),
      task_id: taskId,
      owner_id: ownerId,
      kind,
      revision,
      state: 'queued',
      result_id: null,
      cancel_requested: false,
      error: null,
      created_at: now,
      updated_at: now,
    };
    this.jobs.set(job.id, job);
    if (requestKey) {
      this.requestKeys.set(`${ownerId}:${taskId}:${requestKey}`, job.id);
    }
    this.persist();
    return { job, deduplicated: false };
  }

  updateJob(jobId: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    Object.assign(job, patch, { updated_at: new Date().toISOString() });
    this.persist();
    return job;
  }

  saveArtifact(
    taskId: string,
    kind: Kind,
    id: string,
    body: unknown,
    opts: { status?: string | null; solution_id?: string | null; suite_id?: string | null } = {}
  ): ArtifactRecord {
    const rec = this.tasks.get(taskId);
    const now = new Date().toISOString();
    const artifact: ArtifactRecord = {
      id,
      task_id: taskId,
      owner_id: rec?.owner_id ?? null,
      kind,
      body,
      status: opts.status ?? null,
      solution_id: opts.solution_id ?? rec?.solution_id ?? null,
      suite_id: opts.suite_id ?? rec?.suite_id ?? null,
      created_at: now,
    };
    this.artifacts.set(id, artifact);

    if (rec) {
      rec.revision += 1;
      rec.updated_at = now;
      if (kind === 'solution') {
        rec.solution_id = id;
        rec.validation_id = null;
      } else if (kind === 'tests') {
        rec.suite_id = id;
        rec.validation_id = null;
      } else if (kind === 'validation') {
        rec.validation_id = id;
      } else if (kind === 'export') {
        rec.export_id = id;
      }
    }

    this.persist();
    return artifact;
  }

  getHistory(taskId: string, kind: Kind, limit: number, offset: number, ownerId: string): HistoryItem[] {
    return Array.from(this.artifacts.values())
      .filter((a) => a.task_id === taskId && a.kind === kind && a.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit)
      .map((a) => ({
        id: a.id,
        created_at: a.created_at,
        status: a.status,
        solution_id: a.solution_id,
        suite_id: a.suite_id,
      }));
  }

  getArtifact(kind: Kind, id: string, ownerId?: string): ArtifactRecord | undefined {
    const artifact = this.artifacts.get(id);
    if (!artifact || artifact.kind !== kind) return undefined;
    if (ownerId && artifact.owner_id !== ownerId) return undefined;
    return artifact;
  }

  saveValidationLog(validationId: string, filename: string, content: string): string {
    const key = `${validationId}/${filename}`;
    this.validationLogs.set(key, content);
    this.persist();
    return key;
  }

  getValidationLog(validationId: string, filename: string, ownerId?: string): string | undefined {
    if (ownerId && !this.getArtifact('validation', validationId, ownerId)) return undefined;
    return this.validationLogs.get(`${validationId}/${filename}`);
  }

  saveEvaluationLog(evaluationId: string, filename: string, content: string): string {
    this.evaluationLogs.set(`${evaluationId}/${filename}`, content);
    this.persist();
    return filename;
  }

  getEvaluationLog(evaluationId: string, filename: string, ownerId?: string): string | undefined {
    if (ownerId && !this.getArtifact('evaluation', evaluationId, ownerId)) return undefined;
    return this.evaluationLogs.get(`${evaluationId}/${filename}`);
  }

  saveExportArchive(id: string, buffer: Buffer, meta: SavedExport) {
    this.exportArchives.set(id, { buffer, meta });
    try {
      fs.mkdirSync(this.exportsDir, { recursive: true });
      fs.writeFileSync(path.join(this.exportsDir, `${id}.zip`), buffer);
    } catch (err) {
      console.warn('[MIRAI Store] Could not write export archive to disk:', err);
    }
    this.persist();
  }

  getExportArchive(id: string, ownerId?: string) {
    if (ownerId && !this.getArtifact('export', id, ownerId)) return undefined;
    return this.exportArchives.get(id);
  }

  getEvaluationLeaderboard(
    ownerId: string,
    opts: {
      scope?: LeaderboardScope;
      language?: string;
      difficulty?: string;
      category?: string;
    } = {}
  ): LeaderboardResponse {
    const scope: LeaderboardScope = opts.scope === 'all_runs' ? 'all_runs' : 'latest_per_task';

    const wilson95 = (k: number, n: number): [number, number] | null => {
      if (n <= 0) return null;
      const z = 1.96;
      const p = k / n;
      const denom = 1 + (z * z) / n;
      const center = (p + (z * z) / (2 * n)) / denom;
      const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
      return [Math.max(0, center - margin), Math.min(1, center + margin)];
    };

    const makeRate = (numerator: number, denominator: number): Rate => ({
      numerator,
      denominator,
      value: denominator > 0 ? numerator / denominator : null,
      wilson95: wilson95(numerator, denominator),
    });

    const inferProvider = (model: string, label: string): 'gemini' | 'groq' | 'adaption' | 'other' => {
      const m = model.toLowerCase();
      const l = label.toLowerCase();
      if (m.startsWith('gemini/') || l === 'gemini' || m.includes('gemini')) return 'gemini';
      if (m.startsWith('groq/') || l.includes('gpt-oss') || m.includes('gpt-oss')) return 'groq';
      if (m.startsWith('adaption/') || l.includes('qwen') || m.includes('qwen')) return 'adaption';
      return 'other';
    };

    const formatDisplayName = (model: string, label: string, provider: 'gemini' | 'groq' | 'adaption' | 'other'): string => {
      const lowerModel = model.toLowerCase();
      const lowerLabel = label.toLowerCase();
      if (lowerModel.includes('gpt-oss-120b') || lowerLabel === 'gpt-oss-120b') return 'GPT-OSS 120B';
      if (lowerModel.includes('qwen3.5-397b') || lowerLabel === 'qwen') return 'Qwen 3.5 397B';
      if (lowerModel.includes('qwen')) {
        const slug = model.split('/').pop() || label;
        return slug.replace(/^qwen/i, 'Qwen ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (provider === 'gemini') {
        const slug = model.replace(/^gemini\//i, '').trim();
        if (!slug || slug === 'gemini') return 'Gemini';
        return slug
          .split(/[-_]+/)
          .filter(Boolean)
          .map((part) => (part.toLowerCase() === 'gemini' ? 'Gemini' : part.charAt(0).toUpperCase() + part.slice(1)))
          .join(' ');
      }
      if (model && model !== label) {
        return model.split('/').pop() || label;
      }
      return label || 'Unknown Model';
    };

    // Collect all agent evaluation artifacts belonging to this user, newest first
    const allAgentEvalArtifacts = Array.from(this.artifacts.values())
      .filter((a) => a.kind === 'evaluation' && a.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((artifact) => ({
        artifact,
        report: artifact.body as EvaluationReport,
        taskRec: this.tasks.get(artifact.task_id),
      }))
      .filter(({ report }) => report && report.mode === 'agent' && Array.isArray(report.metrics) && report.metrics.length > 0);

    // Collect available filter options from all evaluated tasks before applying filters
    const langSet = new Set<string>();
    const diffSet = new Set<string>();
    const catSet = new Set<string>();

    const extractMeta = (entry: (typeof allAgentEvalArtifacts)[number]) => {
      const task = entry.taskRec?.task;
      const pkg = entry.report.package;
      return {
        task_id: entry.artifact.task_id,
        task_title: task?.title || `Task ${entry.artifact.task_id.slice(0, 8)}`,
        project_name: task?.project_name || 'Workspace Repository',
        language: (task?.language || pkg?.language || 'Unknown').trim() || 'Unknown',
        difficulty: (task?.difficulty || pkg?.difficulty || 'medium').trim() || 'medium',
        category: (task?.category || pkg?.category || 'feature').trim() || 'feature',
      };
    };

    for (const entry of allAgentEvalArtifacts) {
      const meta = extractMeta(entry);
      if (meta.language) langSet.add(meta.language);
      if (meta.difficulty) diffSet.add(meta.difficulty);
      if (meta.category) catSet.add(meta.category);
    }

    // Apply user filters
    const filteredEntries = allAgentEvalArtifacts.filter((entry) => {
      const meta = extractMeta(entry);
      if (opts.language && meta.language.toLowerCase() !== opts.language.toLowerCase()) return false;
      if (opts.difficulty && meta.difficulty.toLowerCase() !== opts.difficulty.toLowerCase()) return false;
      if (opts.category && meta.category.toLowerCase() !== opts.category.toLowerCase()) return false;
      return true;
    });

    // Scope selection: latest_per_task picks the newest agent evaluation per task_id
    const selectedEntries: typeof filteredEntries = [];
    if (scope === 'latest_per_task') {
      const seenTasks = new Set<string>();
      for (const entry of filteredEntries) {
        if (seenTasks.has(entry.artifact.task_id)) continue;
        seenTasks.add(entry.artifact.task_id);
        selectedEntries.push(entry);
      }
    } else {
      selectedEntries.push(...filteredEntries);
    }

    interface ModelAccumulator {
      model_key: string;
      label: string;
      display_name: string;
      model: string;
      provider: 'gemini' | 'groq' | 'adaption' | 'other';
      taskIds: Set<string>;
      campaigns_count: number;
      scheduled: number;
      scored: number;
      verified_num: number;
      verified_den: number;
      feature_num: number;
      feature_den: number;
      regression_num: number;
      regression_den: number;
      build_num: number;
      build_den: number;
      partial_weighted_sum: number;
      partial_weight: number;
      feature_cases_passed: number;
      feature_cases_total: number;
      regression_cases_passed: number;
      regression_cases_total: number;
      latency_weighted_sum: number;
      latency_weight: number;
      input_tokens_sum: number;
      has_input_tokens: boolean;
      output_tokens_sum: number;
      has_output_tokens: boolean;
      cost_usd_sum: number;
      has_cost: boolean;
      failure_counts: Record<string, number>;
    }

    const accumulators = new Map<string, ModelAccumulator>();
    const failureMatrix = new Map<string, { total: number; by_model: Record<string, number> }>();
    const taskMatrix: LeaderboardTaskRow[] = [];
    const distinctTasks = new Set<string>();

    let totalScheduled = 0;
    let totalScored = 0;
    let totalPassed = 0;

    for (const entry of selectedEntries) {
      const { artifact, report } = entry;
      const meta = extractMeta(entry);
      distinctTasks.add(meta.task_id);

      const rowModels: Record<string, LeaderboardTaskModelCell> = {};

      for (const metric of report.metrics) {
        const matchedTrial = report.trials.find((t) => t.label === metric.label);
        const resolvedModel = (
          metric.model ||
          matchedTrial?.configuration?.model ||
          matchedTrial?.resolved_models?.[0] ||
          metric.label
        ).trim();
        const modelKey = resolvedModel.toLowerCase();
        const provider = inferProvider(resolvedModel, metric.label);
        const displayName = formatDisplayName(resolvedModel, metric.label, provider);

        let acc = accumulators.get(modelKey);
        if (!acc) {
          acc = {
            model_key: modelKey,
            label: metric.label,
            display_name: displayName,
            model: resolvedModel,
            provider,
            taskIds: new Set<string>(),
            campaigns_count: 0,
            scheduled: 0,
            scored: 0,
            verified_num: 0,
            verified_den: 0,
            feature_num: 0,
            feature_den: 0,
            regression_num: 0,
            regression_den: 0,
            build_num: 0,
            build_den: 0,
            partial_weighted_sum: 0,
            partial_weight: 0,
            feature_cases_passed: 0,
            feature_cases_total: 0,
            regression_cases_passed: 0,
            regression_cases_total: 0,
            latency_weighted_sum: 0,
            latency_weight: 0,
            input_tokens_sum: 0,
            has_input_tokens: false,
            output_tokens_sum: 0,
            has_output_tokens: false,
            cost_usd_sum: 0,
            has_cost: false,
            failure_counts: {},
          };
          accumulators.set(modelKey, acc);
        }

        acc.taskIds.add(meta.task_id);
        acc.campaigns_count += 1;
        acc.scheduled += metric.scheduled || 0;
        acc.scored += metric.scored || 0;

        acc.verified_num += metric.verified_success?.numerator || 0;
        acc.verified_den += metric.verified_success?.denominator || 0;
        acc.feature_num += metric.feature_pass?.numerator || 0;
        acc.feature_den += metric.feature_pass?.denominator || 0;
        acc.regression_num += metric.regression_pass?.numerator || 0;
        acc.regression_den += metric.regression_pass?.denominator || 0;
        acc.build_num += metric.build_success?.numerator || 0;
        acc.build_den += metric.build_success?.denominator || 0;

        if (typeof metric.feature_cases_passed === 'number') acc.feature_cases_passed += metric.feature_cases_passed;
        if (typeof metric.feature_cases_total === 'number') acc.feature_cases_total += metric.feature_cases_total;
        if (typeof metric.regression_cases_passed === 'number') acc.regression_cases_passed += metric.regression_cases_passed;
        if (typeof metric.regression_cases_total === 'number') acc.regression_cases_total += metric.regression_cases_total;
        if (typeof metric.mean_partial_score === 'number' && Number.isFinite(metric.mean_partial_score)) {
          const pWeight = Math.max(1, metric.scored || 1);
          acc.partial_weighted_sum += metric.mean_partial_score * pWeight;
          acc.partial_weight += pWeight;
        }

        totalScheduled += metric.scheduled || 0;
        totalScored += metric.scored || 0;
        totalPassed += metric.verified_success?.numerator || 0;

        if (typeof metric.mean_agent_seconds === 'number' && Number.isFinite(metric.mean_agent_seconds)) {
          const weight = Math.max(1, metric.scored || metric.scheduled || 1);
          acc.latency_weighted_sum += metric.mean_agent_seconds * weight;
          acc.latency_weight += weight;
        }
        if (typeof metric.input_tokens_total === 'number' && Number.isFinite(metric.input_tokens_total)) {
          acc.input_tokens_sum += metric.input_tokens_total;
          acc.has_input_tokens = true;
        }
        if (typeof metric.output_tokens_total === 'number' && Number.isFinite(metric.output_tokens_total)) {
          acc.output_tokens_sum += metric.output_tokens_total;
          acc.has_output_tokens = true;
        }
        if (typeof metric.cost_usd_total === 'number' && Number.isFinite(metric.cost_usd_total)) {
          acc.cost_usd_sum += metric.cost_usd_total;
          acc.has_cost = true;
        }

        let cellTopFailure: string | null = null;
        let cellTopFailureCount = 0;
        for (const [category, count] of Object.entries(metric.failure_counts || {})) {
          if (!count || count <= 0) continue;
          acc.failure_counts[category] = (acc.failure_counts[category] || 0) + count;
          const bucket = failureMatrix.get(category) || { total: 0, by_model: {} };
          bucket.total += count;
          bucket.by_model[modelKey] = (bucket.by_model[modelKey] || 0) + count;
          failureMatrix.set(category, bucket);
          if (count > cellTopFailureCount) {
            cellTopFailureCount = count;
            cellTopFailure = category;
          }
        }

        const cellTotalTokens =
          typeof metric.input_tokens_total === 'number' || typeof metric.output_tokens_total === 'number'
            ? (metric.input_tokens_total || 0) + (metric.output_tokens_total || 0)
            : null;

        rowModels[modelKey] = {
          model_key: modelKey,
          display_name: displayName,
          scored: metric.scored || 0,
          scheduled: metric.scheduled || 0,
          passed: metric.verified_success?.numerator || 0,
          pass_rate: metric.verified_success?.value ?? null,
          mean_agent_seconds:
            typeof metric.mean_agent_seconds === 'number' && Number.isFinite(metric.mean_agent_seconds)
              ? metric.mean_agent_seconds
              : null,
          total_tokens: cellTotalTokens,
          top_failure: cellTopFailure,
        };
      }

      taskMatrix.push({
        task_id: meta.task_id,
        task_title: meta.task_title,
        project_name: meta.project_name,
        language: meta.language,
        difficulty: meta.difficulty,
        category: meta.category,
        evaluation_id: report.id,
        evaluated_at: artifact.created_at,
        models: rowModels,
      });
    }

    const models: LeaderboardModelEntry[] = Array.from(accumulators.values()).map((acc) => {
      const verified_success = makeRate(acc.verified_num, acc.verified_den);
      const feature_pass = makeRate(acc.feature_num, acc.feature_den);
      const regression_pass = makeRate(acc.regression_num, acc.regression_den);
      const build_success = makeRate(acc.build_num, acc.build_den);
      const mean_agent_seconds =
        acc.latency_weight > 0 ? Number((acc.latency_weighted_sum / acc.latency_weight).toFixed(2)) : null;
      const input_tokens_total = acc.has_input_tokens ? Math.round(acc.input_tokens_sum) : null;
      const output_tokens_total = acc.has_output_tokens ? Math.round(acc.output_tokens_sum) : null;
      const total_tokens =
        input_tokens_total !== null || output_tokens_total !== null
          ? (input_tokens_total || 0) + (output_tokens_total || 0)
          : null;
      const trialDenom = Math.max(acc.scored, acc.scheduled);
      const avg_tokens_per_trial =
        total_tokens !== null && trialDenom > 0 ? Math.round(total_tokens / trialDenom) : null;

      let top_failure: string | null = null;
      let topFailureCount = 0;
      for (const [cat, count] of Object.entries(acc.failure_counts)) {
        if (count > topFailureCount) {
          topFailureCount = count;
          top_failure = cat;
        }
      }

      return {
        model_key: acc.model_key,
        label: acc.label,
        display_name: acc.display_name,
        model: acc.model,
        provider: acc.provider,
        tasks_evaluated: acc.taskIds.size,
        campaigns_count: acc.campaigns_count,
        scheduled: acc.scheduled,
        scored: acc.scored,
        verified_success,
        feature_pass,
        regression_pass,
        build_success,
        mean_partial_score:
          acc.partial_weight > 0
            ? Number((acc.partial_weighted_sum / acc.partial_weight).toFixed(4))
            : null,
        feature_cases_passed: acc.feature_cases_passed,
        feature_cases_total: acc.feature_cases_total,
        regression_cases_passed: acc.regression_cases_passed,
        regression_cases_total: acc.regression_cases_total,
        mean_agent_seconds,
        input_tokens_total,
        output_tokens_total,
        total_tokens,
        avg_tokens_per_trial,
        cost_usd_total: acc.has_cost ? Number(acc.cost_usd_sum.toFixed(6)) : null,
        failure_counts: acc.failure_counts,
        top_failure,
      };
    });

    models.sort((a, b) => {
      const aVal = a.verified_success.value ?? -1;
      const bVal = b.verified_success.value ?? -1;
      if (bVal !== aVal) return bVal - aVal;
      const aFeat = a.feature_pass.value ?? -1;
      const bFeat = b.feature_pass.value ?? -1;
      if (bFeat !== aFeat) return bFeat - aFeat;
      const aLat = a.mean_agent_seconds ?? Number.POSITIVE_INFINITY;
      const bLat = b.mean_agent_seconds ?? Number.POSITIVE_INFINITY;
      if (aLat !== bLat) return aLat - bLat;
      return b.scored - a.scored;
    });

    const failure_breakdown: LeaderboardFailureBucket[] = Array.from(failureMatrix.entries())
      .map(([category, bucket]) => ({
        category,
        total: bucket.total,
        by_model: bucket.by_model,
      }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

    const scoredModels = models.filter((m) => m.scored > 0);
    const leader = scoredModels[0] || models[0] || null;

    const latencyModels = models
      .filter((m) => typeof m.mean_agent_seconds === 'number' && m.mean_agent_seconds > 0)
      .sort((a, b) => (a.mean_agent_seconds ?? Infinity) - (b.mean_agent_seconds ?? Infinity));
    const fastest = latencyModels[0] || null;

    return {
      scope,
      filters: {
        language: opts.language ?? null,
        difficulty: opts.difficulty ?? null,
        category: opts.category ?? null,
      },
      available_filters: {
        languages: Array.from(langSet).sort((a, b) => a.localeCompare(b)),
        difficulties: Array.from(diffSet).sort((a, b) => a.localeCompare(b)),
        categories: Array.from(catSet).sort((a, b) => a.localeCompare(b)),
      },
      summary: {
        tasks_evaluated: distinctTasks.size,
        campaigns_count: selectedEntries.length,
        total_trials_scheduled: totalScheduled,
        total_trials_scored: totalScored,
        total_trials_passed: totalPassed,
        overall_pass_rate: totalScored > 0 ? totalPassed / totalScored : null,
        leading_model: leader
          ? {
              model_key: leader.model_key,
              display_name: leader.display_name,
              pass_rate: leader.verified_success.value,
              scored: leader.scored,
            }
          : null,
        fastest_model:
          fastest && fastest.mean_agent_seconds !== null
            ? {
                model_key: fastest.model_key,
                display_name: fastest.display_name,
                mean_agent_seconds: fastest.mean_agent_seconds,
              }
            : null,
      },
      models,
      failure_breakdown,
      task_matrix: taskMatrix,
      generated_at: new Date().toISOString(),
    };
  }

  formatLeaderboardCsv(data: LeaderboardResponse): string {
    const csvEscape = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };
    const pct = (rate: Rate) => (rate.value === null ? '' : `${(rate.value * 100).toFixed(1)}%`);

    const header = [
      'rank',
      'display_name',
      'model_id',
      'provider',
      'tasks_evaluated',
      'campaigns',
      'scored',
      'scheduled',
      'verified_pass_rate',
      'verified_passed',
      'mean_partial_score',
      'feature_cases_passed',
      'feature_cases_total',
      'feature_pass_rate',
      'regression_pass_rate',
      'build_success_rate',
      'mean_latency_seconds',
      'input_tokens_total',
      'output_tokens_total',
      'total_tokens',
      'avg_tokens_per_trial',
      'top_failure',
    ];

    const rows = data.models.map((m, idx) =>
      [
        idx + 1,
        m.display_name,
        m.model,
        m.provider,
        m.tasks_evaluated,
        m.campaigns_count,
        m.scored,
        m.scheduled,
        pct(m.verified_success),
        m.verified_success.numerator,
        m.mean_partial_score !== null && m.mean_partial_score !== undefined
          ? `${(m.mean_partial_score * 100).toFixed(1)}%`
          : '',
        m.feature_cases_passed ?? '',
        m.feature_cases_total ?? '',
        pct(m.feature_pass),
        pct(m.regression_pass),
        pct(m.build_success),
        m.mean_agent_seconds !== null ? m.mean_agent_seconds.toFixed(2) : '',
        m.input_tokens_total ?? '',
        m.output_tokens_total ?? '',
        m.total_tokens ?? '',
        m.avg_tokens_per_trial ?? '',
        m.top_failure ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );

    return [header.join(','), ...rows].join('\n');
  }
}

export const store = new DiskBackedWorkflowStore();
export type { EvaluationReport };
