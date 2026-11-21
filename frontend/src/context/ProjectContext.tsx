import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { taskService } from '../services/taskService';
import { workflow } from '../services/workflowService';
import {
  syncUserProjectFromAnalysis,
  syncUserTaskBasic,
  syncUserTaskFromDetail,
} from '../services/firestoreSync';
import { useAuth } from './AuthContext';
import type { RepoAnalysisResponse } from '../types/repo';
import type { TaskResponse } from '../types/task';
import type { Job, JobOptions, Kind, TaskDetail } from '../types/workflow';
import { isActive } from '../types/workflow';

interface Selection { task?: string; snapshot?: string }

function getSelectionKey(uid: string | undefined): string {
  return uid ? `ctf.selection.v1.${uid}` : 'ctf.selection.v1';
}

function readSelection(uid: string | undefined): Selection {
  try {
    const value = JSON.parse(localStorage.getItem(getSelectionKey(uid)) || '{}');
    return {
      task: typeof value?.task === 'string' ? value.task : undefined,
      snapshot: typeof value?.snapshot === 'string' ? value.snapshot : undefined,
    };
  } catch { return {}; }
}

interface ProjectContextValue {
  repoAnalysis: RepoAnalysisResponse | null;
  task: TaskResponse | null;
  solution: TaskDetail['solution'];
  testSuite: TaskDetail['test_suite'];
  validationReport: TaskDetail['validation'];
  savedExport: TaskDetail['export'];
  loading: boolean;
  loadError: string;
  refresh: () => void;
  setRepoAnalysis: (analysis: RepoAnalysisResponse) => void;
  setTask: (task: TaskResponse) => void;
  selectTask: (id: string) => void;
  resetProject: () => void;
  job: Job | null;
  active: boolean;
  queue: (kind: Kind, options?: JobOptions) => Promise<void>;
  cancelJob: () => Promise<void>;
  backendHealth: 'online' | 'offline' | 'checking';
  checkBackendHealth: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);
export const ProjectProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user } = useAuth();
  const uid = user?.uid;
  const selectionKey = getSelectionKey(uid);

  const [selection, setSelection] = useState<Selection>(() => readSelection(uid));
  const selected = useRef(selection);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [snapshot, setSnapshot] = useState<RepoAnalysisResponse | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  const [loading, setLoading] = useState(() => Boolean(selection.task || selection.snapshot));
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [backendHealth, setBackendHealth] = useState<ProjectContextValue['backendHealth']>('checking');
  const refresh = useCallback(() => setReload(value => value + 1), []);

  // Re-scope selection cleanly whenever the authenticated user changes
  const prevUid = useRef(uid);
  useEffect(() => {
    if (prevUid.current === uid) return;
    prevUid.current = uid;
    const next = readSelection(uid);
    selected.current = next;
    setSelection(next);
    setDetail(null);
    setSnapshot(null);
    setJob(null);
    setLoadError('');
    setLoading(Boolean(next.task || next.snapshot));
  }, [uid]);

  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await taskService.checkHealth();
      setBackendHealth(res.status === 'healthy' ? 'online' : 'offline');
    } catch { setBackendHealth('offline'); }
  }, []);

  useEffect(() => {
    void checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  const select = (next: Selection) => {
    selected.current = next;
    setSelection(next);
    setDetail(null);
    setSnapshot(null);
    setJob(null);
    setLoadError('');
    setLoading(Boolean(next.task || next.snapshot));
    try { localStorage.setItem(selectionKey, JSON.stringify(next)); } catch { /* Selection can stay in memory. */ }
  };

  useEffect(() => {
    if (!selection.task && !selection.snapshot) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    const fetchSelection = async () => {
      try {
        if (selection.task) {
          const saved = await workflow.task(selection.task, controller.signal);
          if (controller.signal.aborted || selected.current !== selection) return;
          setDetail(saved);
          setJob(saved.jobs[0] ?? null);
          if (user) {
            void syncUserTaskFromDetail(user, saved).catch(() => {});
            if (saved.snapshot) {
              void syncUserProjectFromAnalysis(user, saved.snapshot, saved.project_id).catch(() => {});
            }
          }
        } else if (selection.snapshot) {
          const saved = await workflow.snapshot(selection.snapshot, controller.signal);
          if (!controller.signal.aborted && selected.current === selection) {
            setSnapshot(saved);
            if (user) {
              void syncUserProjectFromAnalysis(user, saved).catch(() => {});
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && selected.current === selection) {
          if ((error as { statusCode?: number }).statusCode === 404) {
            selected.current = {};
            setSelection({});
            try { localStorage.removeItem(selectionKey); } catch { /* Ignore storage errors. */ }
            setLoadError('');
          } else {
            setLoadError((error as Error).message);
          }
        }
      } finally {
        if (!controller.signal.aborted && selected.current === selection) setLoading(false);
      }
    };
    void fetchSelection();
    const sync = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', sync);
    return () => {
      controller.abort();
      window.removeEventListener('focus', sync);
    };
  }, [selection, selectionKey, reload, refresh, user]);

  const activeJobId = job && isActive(job) ? job.id : null;
  useEffect(() => {
    if (!activeJobId) return;
    const controller = new AbortController();
    let timer: number;
    let delay = 850;
    const poll = async () => {
      try {
        const current = await workflow.job(activeJobId, controller.signal);
        if (controller.signal.aborted || selected.current !== selection) return;
        setJob(current);
        setLoadError('');
        if (!isActive(current)) {
          refresh();
          return;
        }
        delay = 850;
      } catch (error) {
        if (controller.signal.aborted || selected.current !== selection) return;
        setLoadError((error as Error).message);
        delay = Math.min(delay * 2, 15000);
      }
      timer = window.setTimeout(poll, delay);
    };
    timer = window.setTimeout(poll, delay);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeJobId, selection, refresh]);

  const queue = async (kind: Kind, options: JobOptions = {}) => {
    if (!detail || inFlight.current || activeJobId) return;
    inFlight.current = true;
    setSubmitting(true);
    const requestSelection = selected.current;
    const body = JSON.stringify([detail.task.id, detail.revision, kind, options]);
    if (intent.current?.body !== body) intent.current = { body, key: crypto.randomUUID() };
    try {
      const current = await workflow.queue(detail.task.id, detail.revision, kind, intent.current.key, options);
      intent.current = null;
      if (selected.current === requestSelection) {
        setJob(current);
        if (!isActive(current)) refresh();
      }
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) refresh();
      throw error;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const cancelJob = async () => {
    if (!activeJobId) return;
    const requestSelection = selected.current;
    const canceled = await workflow.cancel(activeJobId);
    if (selected.current !== requestSelection) return;
    setJob(canceled);
    if (!isActive(canceled)) refresh();
  };

  const handleSetRepoAnalysis = (analysis: RepoAnalysisResponse) => {
    if (user) {
      void syncUserProjectFromAnalysis(user, analysis).catch(() => {});
    }
    select({ snapshot: analysis.snapshot_id ?? undefined });
  };

  const handleSetTask = (nextTask: TaskResponse) => {
    if (user) {
      void syncUserTaskBasic(user, nextTask).catch(() => {});
    }
    select({ task: nextTask.id });
  };

  return (
    <ProjectContext.Provider value={{
      repoAnalysis: detail?.snapshot ?? snapshot, task: detail?.task ?? null,
      solution: detail?.solution ?? null, testSuite: detail?.test_suite ?? null,
      validationReport: detail?.validation ?? null, savedExport: detail?.export ?? null,
      setRepoAnalysis: handleSetRepoAnalysis,
      setTask: handleSetTask, selectTask: id => select({ task: id }),
      resetProject: () => select({}), refresh, loading, loadError, job,
      active: submitting || Boolean(activeJobId), queue, cancelJob, backendHealth, checkBackendHealth,
    }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = (): ProjectContextValue => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within a ProjectProvider');
  return context;
};
