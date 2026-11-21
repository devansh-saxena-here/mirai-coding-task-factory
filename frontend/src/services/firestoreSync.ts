import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { RepoAnalysisResponse } from '../types/repo';
import type { TaskResponse } from '../types/task';
import type { TaskDetail } from '../types/workflow';

export interface CloudProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  snapshotId: string;
  sourceType: 'github' | 'zip' | 'unknown';
  repositoryIdentity: string;
  commitSha: string;
  fileCount: number;
  detectedLanguages: string[];
  detectedFrameworks: string[];
  readmeSummary?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CloudTaskRecord {
  id: string;
  ownerId: string;
  projectId: string;
  projectName?: string;
  snapshotId: string;
  title: string;
  description?: string;
  requirements?: string[];
  acceptanceCriteria?: string[];
  relevantFiles?: string[];
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: string;
  category: string;
  verdict: 'PENDING' | 'VALIDATED' | 'REJECTED' | 'NOT_VALIDATED';
  revision: number;
  hasSolution: boolean;
  hasTestSuite: boolean;
  hasExport: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

const ensuredProfiles = new Set<string>();

function sanitizeId(raw: string | null | undefined, fallback = 'item'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  return cleaned || fallback;
}

function clampString(raw: string | null | undefined, maxLen: number, fallback = ''): string {
  const str = String(raw ?? '').trim();
  if (!str) return fallback.slice(0, maxLen);
  return str.slice(0, maxLen);
}

function clampStringList(items: string[] | null | undefined, maxItems = 12, maxItemLen = 64): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, maxItemLen);
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function resolveProviderId(user: User): 'google.com' | 'github.com' {
  const providers = user.providerData.map((p) => p.providerId);
  if (providers.includes('github.com') && !providers.includes('google.com')) {
    return 'github.com';
  }
  if (providers[0] === 'github.com') {
    return 'github.com';
  }
  return 'google.com';
}

function normalizeSourceType(raw: string | null | undefined): 'github' | 'zip' | 'unknown' {
  if (raw === 'github' || raw === 'zip') return raw;
  return 'unknown';
}

function normalizeDifficulty(raw: string | null | undefined): 'easy' | 'medium' | 'hard' {
  const lower = String(raw || '').toLowerCase();
  if (lower === 'easy' || lower === 'hard') return lower;
  return 'medium';
}

function normalizeVerdict(raw: string | null | undefined): 'PENDING' | 'VALIDATED' | 'REJECTED' | 'NOT_VALIDATED' {
  const upper = String(raw || '').toUpperCase();
  if (upper === 'VALIDATED' || upper === 'REJECTED' || upper === 'NOT_VALIDATED' || upper === 'PENDING') {
    return upper;
  }
  return 'PENDING';
}

function toMillis(ts: unknown): number {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

export async function syncUserProfile(user: User): Promise<boolean> {
  if (!user.emailVerified) {
    return false;
  }

  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = clampString(user.displayName || user.email?.split('@')[0], 120, 'MIRAI User');
  const email = clampString(user.email, 254, '');
  const photoURL = clampString(user.photoURL, 1024, '');
  const providerId = resolveProviderId(user);

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      const payload: Record<string, unknown> = {
        uid: user.uid,
        displayName,
        email,
        providerId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) payload.photoURL = photoURL;
      await setDoc(ref, payload);
    } else {
      const updatePayload: Record<string, unknown> = {
        displayName,
        email,
        providerId,
        updatedAt: serverTimestamp(),
      };
      if (photoURL) updatePayload.photoURL = photoURL;
      await updateDoc(ref, updatePayload);
    }
    ensuredProfiles.add(user.uid);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

async function ensureParentProfile(user: User): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (ensuredProfiles.has(user.uid)) return true;
  return syncUserProfile(user);
}

export async function syncUserProjectFromAnalysis(
  user: User,
  analysis: RepoAnalysisResponse,
  projectIdOverride?: string | null
): Promise<void> {
  const ready = await ensureParentProfile(user);
  if (!ready) return;

  const projectId = sanitizeId(projectIdOverride || analysis.snapshot_id || analysis.project_name, 'project');
  const snapshotId = sanitizeId(analysis.snapshot_id || projectId, projectId);
  const path = `users/${user.uid}/projects/${projectId}`;
  const ref = doc(db, 'users', user.uid, 'projects', projectId);

  const readmeSummary = clampString(analysis.readme_summary, 1500, '');
  const mutableFields: Record<string, unknown> = {
    name: clampString(analysis.project_name, 160, 'Untitled Repository'),
    snapshotId,
    sourceType: normalizeSourceType(analysis.source_type),
    repositoryIdentity: clampString(analysis.repository_identity, 512, ''),
    commitSha: clampString(analysis.commit_sha, 64, ''),
    fileCount: Math.max(0, Math.min(50000, Math.floor(Number(analysis.file_count) || 0))),
    detectedLanguages: clampStringList(analysis.detected_languages, 12, 64),
    detectedFrameworks: clampStringList(analysis.detected_frameworks, 12, 64),
    updatedAt: serverTimestamp(),
  };
  if (readmeSummary) {
    mutableFields.readmeSummary = readmeSummary;
  }

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        id: projectId,
        ownerId: user.uid,
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, mutableFields);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncUserTaskBasic(
  user: User,
  task: TaskResponse,
  options?: {
    projectId?: string | null;
    verdict?: string | null;
    revision?: number;
    hasSolution?: boolean;
    hasTestSuite?: boolean;
    hasExport?: boolean;
  }
): Promise<void> {
  const ready = await ensureParentProfile(user);
  if (!ready) return;

  const taskId = sanitizeId(task.id, 'task');
  const path = `users/${user.uid}/tasks/${taskId}`;
  const ref = doc(db, 'users', user.uid, 'tasks', taskId);

  const projectName = clampString(task.project_name, 160, '');
  const description = clampString(task.description, 4000, '');
  const requirements = clampStringList(task.requirements, 12, 400);
  const acceptanceCriteria = clampStringList(task.acceptance_criteria, 12, 400);
  const relevantFiles = clampStringList(task.relevant_files, 20, 200);

  const baseFields: Record<string, unknown> = {
    projectId: clampString(options?.projectId, 128, ''),
    snapshotId: clampString(task.snapshot_id, 128, ''),
    title: clampString(task.title, 240, 'Untitled Task'),
    topic: clampString(task.topic, 200, ''),
    difficulty: normalizeDifficulty(task.difficulty),
    language: clampString(task.language, 64, 'Unknown'),
    category: clampString(task.category, 64, 'backend'),
    updatedAt: serverTimestamp(),
  };

  if (options?.verdict !== undefined) {
    baseFields.verdict = normalizeVerdict(options.verdict);
  }
  if (options?.revision !== undefined) {
    baseFields.revision = Math.max(1, Math.min(100000, Math.floor(Number(options.revision) || 1)));
  }
  if (options?.hasSolution !== undefined) {
    baseFields.hasSolution = Boolean(options.hasSolution);
  }
  if (options?.hasTestSuite !== undefined) {
    baseFields.hasTestSuite = Boolean(options.hasTestSuite);
  }
  if (options?.hasExport !== undefined) {
    baseFields.hasExport = Boolean(options.hasExport);
  }

  if (projectName) baseFields.projectName = projectName;
  if (description) baseFields.description = description;
  if (requirements.length > 0) baseFields.requirements = requirements;
  if (acceptanceCriteria.length > 0) baseFields.acceptanceCriteria = acceptanceCriteria;
  if (relevantFiles.length > 0) baseFields.relevantFiles = relevantFiles;

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        id: taskId,
        ownerId: user.uid,
        verdict: normalizeVerdict(options?.verdict),
        revision: Math.max(1, Math.min(100000, Math.floor(Number(options?.revision) || 1))),
        hasSolution: Boolean(options?.hasSolution),
        hasTestSuite: Boolean(options?.hasTestSuite),
        hasExport: Boolean(options?.hasExport),
        ...baseFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, baseFields);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncUserTaskFromDetail(user: User, detail: TaskDetail): Promise<void> {
  await syncUserTaskBasic(user, detail.task, {
    projectId: detail.project_id,
    verdict: detail.validation?.overall_verdict,
    revision: detail.revision,
    hasSolution: Boolean(detail.solution),
    hasTestSuite: Boolean(detail.test_suite),
    hasExport: Boolean(detail.export),
  });
}

export function subscribeUserCloudProjects(
  user: User,
  onUpdate: (projects: CloudProjectRecord[]) => void
): Unsubscribe {
  const projectsPath = `users/${user.uid}/projects`;
  const projectsQuery = query(
    collection(db, 'users', user.uid, 'projects'),
    where('ownerId', '==', user.uid)
  );

  return onSnapshot(
    projectsQuery,
    (snap) => {
      const items: CloudProjectRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: String(d.id || docSnap.id),
          ownerId: String(d.ownerId || user.uid),
          name: String(d.name || 'Untitled Repository'),
          snapshotId: String(d.snapshotId || ''),
          sourceType: normalizeSourceType(d.sourceType),
          repositoryIdentity: String(d.repositoryIdentity || ''),
          commitSha: String(d.commitSha || ''),
          fileCount: Number(d.fileCount) || 0,
          detectedLanguages: Array.isArray(d.detectedLanguages)
            ? d.detectedLanguages.filter((x): x is string => typeof x === 'string')
            : [],
          detectedFrameworks: Array.isArray(d.detectedFrameworks)
            ? d.detectedFrameworks.filter((x): x is string => typeof x === 'string')
            : [],
          readmeSummary: typeof d.readmeSummary === 'string' ? d.readmeSummary : undefined,
          createdAtMs: toMillis(d.createdAt),
          updatedAtMs: toMillis(d.updatedAt),
        };
      });
      items.sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
      onUpdate(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, projectsPath);
      } catch {
        // Logged via structured Firestore error handler
      }
    }
  );
}

export function subscribeUserCloudTasks(
  user: User,
  onUpdate: (tasks: CloudTaskRecord[]) => void
): Unsubscribe {
  const tasksPath = `users/${user.uid}/tasks`;
  const tasksQuery = query(
    collection(db, 'users', user.uid, 'tasks'),
    where('ownerId', '==', user.uid)
  );

  return onSnapshot(
    tasksQuery,
    (snap) => {
      const items: CloudTaskRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: String(d.id || docSnap.id),
          ownerId: String(d.ownerId || user.uid),
          projectId: String(d.projectId || ''),
          projectName: typeof d.projectName === 'string' ? d.projectName : undefined,
          snapshotId: String(d.snapshotId || ''),
          title: String(d.title || 'Untitled Task'),
          description: typeof d.description === 'string' ? d.description : undefined,
          requirements: Array.isArray(d.requirements)
            ? d.requirements.filter((x): x is string => typeof x === 'string')
            : undefined,
          acceptanceCriteria: Array.isArray(d.acceptanceCriteria)
            ? d.acceptanceCriteria.filter((x): x is string => typeof x === 'string')
            : undefined,
          relevantFiles: Array.isArray(d.relevantFiles)
            ? d.relevantFiles.filter((x): x is string => typeof x === 'string')
            : undefined,
          topic: String(d.topic || ''),
          difficulty: normalizeDifficulty(d.difficulty),
          language: String(d.language || 'Unknown'),
          category: String(d.category || 'backend'),
          verdict: normalizeVerdict(d.verdict),
          revision: Number(d.revision) || 1,
          hasSolution: Boolean(d.hasSolution),
          hasTestSuite: Boolean(d.hasTestSuite),
          hasExport: Boolean(d.hasExport),
          createdAtMs: toMillis(d.createdAt),
          updatedAtMs: toMillis(d.updatedAt),
        };
      });
      items.sort((a, b) => (b.updatedAtMs || b.createdAtMs) - (a.updatedAtMs || a.createdAtMs));
      onUpdate(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, tasksPath);
      } catch {
        // Logged via structured Firestore error handler
      }
    }
  );
}

export interface CloudSummary {
  projects: number;
  tasks: number;
}

export function subscribeUserCloudSummary(
  user: User,
  onUpdate: (summary: CloudSummary) => void
): Unsubscribe {
  let projectsCount = 0;
  let tasksCount = 0;

  const unsubProjects = subscribeUserCloudProjects(user, (items) => {
    projectsCount = items.length;
    onUpdate({ projects: projectsCount, tasks: tasksCount });
  });

  const unsubTasks = subscribeUserCloudTasks(user, (items) => {
    tasksCount = items.length;
    onUpdate({ projects: projectsCount, tasks: tasksCount });
  });

  return () => {
    unsubProjects();
    unsubTasks();
  };
}
