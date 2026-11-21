import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useProject } from '../context/ProjectContext';
import {
  subscribeUserCloudProjects,
  subscribeUserCloudTasks,
  syncUserProjectFromAnalysis,
  syncUserTaskBasic,
  type CloudProjectRecord,
  type CloudTaskRecord,
} from '../services/firestoreSync';
import { taskService } from '../services/taskService';
import { workflow } from '../services/workflowService';
import type { Project, TaskList } from '../types/workflow';

const pageSize = 12;

interface MergedProjectRow {
  key: string;
  id: string;
  snapshotId: string;
  name: string;
  languages: string[];
  fileCount: number;
  commitSha: string;
  sourceType: 'github' | 'zip' | 'unknown';
  repositoryIdentity: string;
  liveProject: Project | null;
  cloudProject: CloudProjectRecord | null;
}

interface MergedTaskRow {
  id: string;
  title: string;
  language: string;
  category: string;
  difficulty: string;
  verdict: string;
  projectName: string;
  isLive: boolean;
  cloudTask: CloudTaskRecord | null;
}

function parseGithubIdentity(identity: string, fallbackSha?: string): { repoUrl: string; commitSha?: string } | null {
  const trimmed = identity.trim();
  if (!trimmed.startsWith('https://github.com/')) return null;
  const [repoUrl, identitySha] = trimmed.split('@');
  if (!repoUrl) return null;
  const commitSha = (fallbackSha || identitySha || '').trim() || undefined;
  return { repoUrl, commitSha };
}

export function DashboardPage() {
  const { user } = useAuth();
  const { task, selectTask, setRepoAnalysis, job } = useProject();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [project, setProject] = useState('');
  const [offset, setOffset] = useState(0);
  const [projectOffset, setProjectOffset] = useState(0);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [records, setRecords] = useState<TaskList | null>(null);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectRecord[]>([]);
  const [cloudTasks, setCloudTasks] = useState<CloudTaskRecord[]>([]);
  const [cloudReady, setCloudReady] = useState(false);
  const [error, setError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const syncedProjectIdsRef = useRef<Set<string>>(new Set());
  const syncedTaskIdsRef = useRef<Set<string>>(new Set());

  // Real-time Firebase Cloud Firestore subscriptions for durable per-user history
  useEffect(() => {
    if (!user) {
      setCloudProjects([]);
      setCloudTasks([]);
      setCloudReady(true);
      return;
    }
    setCloudReady(false);
    let projectsLoaded = false;
    let tasksLoaded = false;

    const unsubProjects = subscribeUserCloudProjects(user, (items) => {
      setCloudProjects(items);
      projectsLoaded = true;
      if (tasksLoaded) setCloudReady(true);
    });
    const unsubTasks = subscribeUserCloudTasks(user, (items) => {
      setCloudTasks(items);
      tasksLoaded = true;
      if (projectsLoaded) setCloudReady(true);
    });

    return () => {
      unsubProjects();
      unsubTasks();
    };
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    setProjects(null);
    setProjectError('');
    workflow.projects(projectOffset, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setProjects(result.projects);
      if (user) {
        for (const entry of result.projects) {
          if (!syncedProjectIdsRef.current.has(entry.id)) {
            syncedProjectIdsRef.current.add(entry.id);
            void syncUserProjectFromAnalysis(user, entry.snapshot, entry.id).catch(() => {
              syncedProjectIdsRef.current.delete(entry.id);
            });
          }
        }
      }
    }).catch((err) => {
      if (!controller.signal.aborted) setProjectError((err as Error).message);
    });
    return () => controller.abort();
  }, [projectOffset, retry, user]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (title.trim()) params.set('q', title.trim());
    if (difficulty) params.set('difficulty', difficulty);
    if (project) params.set('project_id', project);
    setRecords(null);
    setError('');
    const timer = window.setTimeout(() => {
      workflow.tasks(params, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setRecords(result);
        if (user) {
          result.tasks.forEach((entry, idx) => {
            if (!syncedTaskIdsRef.current.has(entry.id)) {
              syncedTaskIdsRef.current.add(entry.id);
              const state = result.states[idx];
              void syncUserTaskBasic(user, entry, {
                projectId: state?.project_id,
                verdict: state?.verdict ?? undefined,
              }).catch(() => {
                syncedTaskIdsRef.current.delete(entry.id);
              });
            }
          });
        }
      }).catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [title, difficulty, project, offset, retry, task?.id, job?.result_id, user]);

  // Merge live backend repositories with Firebase Cloud persisted repositories
  const mergedProjects = useMemo<MergedProjectRow[]>(() => {
    const rows: MergedProjectRow[] = [];
    const matchedCloudIds = new Set<string>();

    const liveList = projects ?? [];
    for (const live of liveList) {
      const snap = live.snapshot;
      const matchingCloud = cloudProjects.find(
        (cp) =>
          cp.id === live.id ||
          (snap.snapshot_id && cp.snapshotId === snap.snapshot_id) ||
          (snap.repository_identity && cp.repositoryIdentity === snap.repository_identity)
      ) ?? null;
      if (matchingCloud) matchedCloudIds.add(matchingCloud.id);

      rows.push({
        key: live.id,
        id: live.id,
        snapshotId: snap.snapshot_id || matchingCloud?.snapshotId || '',
        name: live.name,
        languages: snap.detected_languages || [],
        fileCount: snap.file_count || 0,
        commitSha: snap.commit_sha || matchingCloud?.commitSha || '',
        sourceType: snap.source_type || matchingCloud?.sourceType || 'unknown',
        repositoryIdentity: snap.repository_identity || matchingCloud?.repositoryIdentity || '',
        liveProject: live,
        cloudProject: matchingCloud,
      });
    }

    if (projectOffset === 0) {
      for (const cp of cloudProjects) {
        if (matchedCloudIds.has(cp.id)) continue;
        rows.push({
          key: `cloud:${cp.id}`,
          id: cp.id,
          snapshotId: cp.snapshotId,
          name: cp.name,
          languages: cp.detectedLanguages,
          fileCount: cp.fileCount,
          commitSha: cp.commitSha,
          sourceType: cp.sourceType,
          repositoryIdentity: cp.repositoryIdentity,
          liveProject: null,
          cloudProject: cp,
        });
      }
    }

    return rows;
  }, [projects, cloudProjects, projectOffset]);

  // Merge live backend tasks with Firebase Cloud persisted tasks (respecting filters)
  const mergedTasks = useMemo<MergedTaskRow[]>(() => {
    const rows: MergedTaskRow[] = [];
    const seenIds = new Set<string>();

    const liveTasks = records?.tasks ?? [];
    liveTasks.forEach((entry, index) => {
      seenIds.add(entry.id);
      const cloudMatch = cloudTasks.find((ct) => ct.id === entry.id) ?? null;
      rows.push({
        id: entry.id,
        title: entry.title,
        language: entry.language,
        category: entry.category,
        difficulty: entry.difficulty,
        verdict: records?.states[index]?.verdict || cloudMatch?.verdict || 'Awaiting validation',
        projectName: entry.project_name || cloudMatch?.projectName || '',
        isLive: true,
        cloudTask: cloudMatch,
      });
    });

    if (offset === 0) {
      const titleQuery = title.trim().toLowerCase();
      const selectedProjectRow = project
        ? mergedProjects.find((p) => p.id === project || p.snapshotId === project)
        : undefined;

      for (const ct of cloudTasks) {
        if (seenIds.has(ct.id)) continue;
        if (titleQuery) {
          const haystack = `${ct.title} ${ct.topic} ${ct.projectName || ''}`.toLowerCase();
          if (!haystack.includes(titleQuery)) continue;
        }
        if (difficulty && ct.difficulty !== difficulty) continue;
        if (project) {
          const matchesProject =
            ct.projectId === project ||
            (selectedProjectRow &&
              (ct.projectId === selectedProjectRow.id ||
                (selectedProjectRow.snapshotId && ct.snapshotId === selectedProjectRow.snapshotId) ||
                (ct.projectName && ct.projectName === selectedProjectRow.name)));
          if (!matchesProject) continue;
        }

        rows.push({
          id: ct.id,
          title: ct.title,
          language: ct.language,
          category: ct.category,
          difficulty: ct.difficulty,
          verdict: ct.verdict === 'PENDING' ? 'Awaiting validation' : ct.verdict,
          projectName: ct.projectName || '',
          isLive: false,
          cloudTask: ct,
        });
      }
    }

    return rows;
  }, [records, cloudTasks, offset, title, difficulty, project, mergedProjects]);

  const handleRestoreGithubRepo = async (row: MergedProjectRow) => {
    const parsed = parseGithubIdentity(row.repositoryIdentity, row.commitSha);
    if (!parsed) return;
    setRestoreError('');
    setRestoringKey(row.key);
    try {
      const restored = await taskService.analyzeGithub({
        repo_url: parsed.repoUrl,
        commit_sha: parsed.commitSha,
      });
      setRepoAnalysis(restored);
      navigate('/analysis');
    } catch (err) {
      setRestoreError((err as Error).message || 'Could not restore repository snapshot from GitHub.');
    } finally {
      setRestoringKey(null);
    }
  };

  const handleOpenTask = async (row: MergedTaskRow) => {
    if (row.isLive) {
      selectTask(row.id);
      navigate('/task-generator');
      return;
    }
    if (!row.cloudTask) return;

    setRestoreError('');
    setRestoringKey(`task:${row.id}`);
    try {
      const ct = row.cloudTask;
      const linkedProject = cloudProjects.find(
        (cp) =>
          (ct.projectId && cp.id === ct.projectId) ||
          (ct.snapshotId && cp.snapshotId === ct.snapshotId) ||
          (ct.projectName && cp.name === ct.projectName)
      );

      const restored = await workflow.restoreTask({
        task: {
          id: ct.id,
          title: ct.title,
          topic: ct.topic || ct.title,
          difficulty: ct.difficulty,
          language: ct.language,
          category: ct.category,
          description: ct.description,
          requirements: ct.requirements,
          acceptance_criteria: ct.acceptanceCriteria,
          relevant_files: ct.relevantFiles,
          project_name: ct.projectName || linkedProject?.name || null,
          snapshot_id: ct.snapshotId || linkedProject?.snapshotId || null,
          starting_commit_sha: linkedProject?.commitSha || null,
        },
        project: linkedProject
          ? {
              source_type: linkedProject.sourceType,
              repository_identity: linkedProject.repositoryIdentity,
              commit_sha: linkedProject.commitSha,
              project_name: linkedProject.name,
            }
          : undefined,
      });

      selectTask(restored.id);
      navigate('/task-generator');
    } catch (err) {
      setRestoreError((err as Error).message || 'Could not restore saved task from Firebase Cloud.');
    } finally {
      setRestoringKey(null);
    }
  };

  const totalTasksCount = Math.max(records?.total ?? 0, mergedTasks.length);
  const loadingTasks = !records && !cloudReady && !error;
  const loadingProjects = !projects && !cloudReady && !projectError;

  return <>
    <PageHeader
      title="MIRAI Dashboard"
      description="Open saved work, restore repositories from Firebase Cloud history, or start with a new codebase."
      actions={<Link className="btn btn-primary" to="/new-project">New project</Link>}
    />

    {restoreError && (
      <div className="card workflow-panel" role="alert">
        <p>{restoreError}</p>
      </div>
    )}

    <section className="card workflow-panel">
      <div className="workflow-row workflow-spread">
        <h2>Saved tasks</h2>
        <span>
          {totalTasksCount} {totalTasksCount === 1 ? 'task' : 'tasks'}
          {cloudTasks.length > 0 ? ` · ${cloudTasks.length} in Firebase Cloud` : ''}
        </span>
      </div>
      <div className="workflow-row">
        <label>
          Task title
          <input
            type="search"
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => {
              setDifficulty(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        {project && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              setProject('');
              setOffset(0);
            }}
          >
            Clear project filter
          </button>
        )}
      </div>

      {error && (
        <p role="alert">
          {error}{' '}
          <button className="btn btn-secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {loadingTasks && <p role="status">Loading tasks…</p>}
      {!loadingTasks && mergedTasks.length === 0 && <p>No tasks match these filters.</p>}

      {mergedTasks.map((entry) => {
        const isRestoring = restoringKey === `task:${entry.id}`;
        return (
          <div className="workflow-row workflow-spread history-row" key={entry.id}>
            <div>
              <button
                className="btn btn-subtle"
                disabled={isRestoring}
                onClick={() => void handleOpenTask(entry)}
              >
                {isRestoring ? `Restoring ${entry.title}…` : entry.title}
              </button>
              <p>
                {entry.language} · {entry.category} · {entry.difficulty}
                {entry.projectName ? ` · ${entry.projectName}` : ''}
                {entry.isLive
                  ? entry.cloudTask
                    ? ' · Synced to Firebase'
                    : ''
                  : ' · Saved in Firebase Cloud (click to restore)'}
              </p>
            </div>
            <StatusBadge status={entry.verdict} />
          </div>
        );
      })}

      {(offset > 0 || (records?.total || 0) > pageSize) && (
        <div className="workflow-row">
          <button
            className="btn btn-secondary"
            disabled={offset === 0}
            onClick={() => setOffset((n) => n - pageSize)}
          >
            Previous tasks
          </button>
          <button
            className="btn btn-secondary"
            disabled={!records || offset + pageSize >= records.total}
            onClick={() => setOffset((n) => n + pageSize)}
          >
            Next tasks
          </button>
        </div>
      )}
    </section>

    <section className="card workflow-panel">
      <div className="workflow-row workflow-spread">
        <h2>Saved repositories</h2>
        <span>
          {mergedProjects.length} {mergedProjects.length === 1 ? 'repository' : 'repositories'}
          {cloudProjects.length > 0 ? ` · ${cloudProjects.length} in Firebase Cloud` : ''}
        </span>
      </div>

      {projectError && (
        <p role="alert">
          {projectError}{' '}
          <button className="btn btn-secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {loadingProjects && <p role="status">Loading repositories…</p>}
      {!loadingProjects && mergedProjects.length === 0 && (
        <p>
          {projectOffset
            ? 'End of repositories.'
            : 'Add a ZIP archive or public GitHub repository to get started.'}
        </p>
      )}

      {mergedProjects.map((entry) => {
        const isRestoring = restoringKey === entry.key;
        const canRestoreGithub =
          !entry.liveProject &&
          entry.sourceType === 'github' &&
          entry.repositoryIdentity.startsWith('https://github.com/');

        return (
          <div className="workflow-row workflow-spread history-row" key={entry.key}>
            <div>
              <strong>{entry.name}</strong>
              <p>
                {entry.languages.join(', ') || 'Unknown language'} · {entry.fileCount} files
                {entry.commitSha ? ` · ${entry.commitSha.slice(0, 7)}` : ''}
                {entry.liveProject
                  ? entry.cloudProject
                    ? ' · Synced to Firebase'
                    : ''
                  : ' · Saved in Firebase Cloud'}
              </p>
            </div>
            <div className="workflow-row">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setProject(entry.id);
                  setOffset(0);
                }}
              >
                Filter tasks
              </button>
              {entry.liveProject ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setRepoAnalysis(entry.liveProject!.snapshot);
                    navigate('/analysis');
                  }}
                >
                  Open snapshot
                </button>
              ) : canRestoreGithub ? (
                <button
                  className="btn btn-primary"
                  disabled={isRestoring}
                  onClick={() => void handleRestoreGithubRepo(entry)}
                >
                  {isRestoring ? 'Restoring…' : 'Restore & Open'}
                </button>
              ) : (
                <Link className="btn btn-secondary" to="/new-project">
                  Re-upload ZIP
                </Link>
              )}
            </div>
          </div>
        );
      })}

      {(projectOffset > 0 || projects?.length === 10) && (
        <div className="workflow-row">
          <button
            className="btn btn-secondary"
            disabled={!projectOffset}
            onClick={() => setProjectOffset((n) => n - 10)}
          >
            Previous repositories
          </button>
          <button
            className="btn btn-secondary"
            disabled={projects?.length !== 10}
            onClick={() => setProjectOffset((n) => n + 10)}
          >
            Next repositories
          </button>
        </div>
      )}
    </section>
  </>;
}
