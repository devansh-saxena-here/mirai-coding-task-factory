import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Sparkles,
  ArrowRight,
  CheckCircle,
  FileCode,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { AgentProgressBar } from '../components/AgentProgressBar';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { useProject } from '../context/ProjectContext';
import { taskService } from '../services/taskService';
import { TaskDifficulty } from '../types/task';
import type { JobProgressStep } from '../types/workflow';

const CONTEXTUAL_PHASES = [
  {
    id: 'snapshot',
    label: 'Inspecting repository snapshot & file manifest',
    detail: 'Loading immutable commit metadata and source tree',
    atMs: 0,
    targetPct: 16,
  },
  {
    id: 'context',
    label: 'Preparing source context & architecture constraints',
    detail: 'Selecting relevant modules while excluding protected tests',
    atMs: 1400,
    targetPct: 34,
  },
  {
    id: 'gemini',
    label: 'Synthesizing task specification with Gemini AI',
    detail: 'Designing grounded problem statement and target file scope',
    atMs: 3200,
    targetPct: 68,
  },
  {
    id: 'criteria',
    label: 'Structuring requirements & acceptance criteria',
    detail: 'Aligning verifiable requirements (REQ-*) and criteria (AC-*)',
    atMs: 9500,
    targetPct: 88,
  },
  {
    id: 'persist',
    label: 'Validating & saving task artifact',
    detail: 'Waiting for final structured JSON response',
    atMs: 16500,
    targetPct: 94,
  },
];

const STANDALONE_PHASES = [
  {
    id: 'params',
    label: 'Preparing difficulty & category constraints',
    detail: 'Configuring benchmark parameters',
    atMs: 0,
    targetPct: 20,
  },
  {
    id: 'gemini',
    label: 'Synthesizing coding task with Gemini AI',
    detail: 'Generating specification and expected scope',
    atMs: 1800,
    targetPct: 64,
  },
  {
    id: 'criteria',
    label: 'Structuring requirements & acceptance criteria',
    detail: 'Formatting verifiable requirements and criteria',
    atMs: 7500,
    targetPct: 88,
  },
  {
    id: 'persist',
    label: 'Saving task artifact',
    detail: 'Waiting for final structured JSON response',
    atMs: 14000,
    targetPct: 94,
  },
];

export const TaskGeneratorPage: React.FC = () => {
  const navigate = useNavigate();
  const { repoAnalysis, task, setTask } = useProject();

  const [difficulty, setDifficulty] = useState<TaskDifficulty>('medium');
  const [category, setCategory] = useState<string>('backend');
  const [focusArea, setFocusArea] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const phases = repoAnalysis ? CONTEXTUAL_PHASES : STANDALONE_PHASES;

  useEffect(() => {
    if (!isLoading || !startedAtMs) return;

    const tick = () => {
      const elapsed = Date.now() - startedAtMs;
      let idx = 0;
      for (let i = 0; i < phases.length; i++) {
        if (elapsed >= phases[i].atMs) idx = i;
      }
      setActivePhaseIdx(idx);

      const current = phases[idx];
      const next = phases[idx + 1];
      if (next) {
        const span = Math.max(1, next.atMs - current.atMs);
        const ratio = Math.min(1, (elapsed - current.atMs) / span);
        const interpolated = current.targetPct + (next.targetPct - current.targetPct) * ratio * 0.85;
        setProgressPct((prev) => Math.max(prev, Math.min(94, Math.round(interpolated))));
      } else {
        // Gentle asymptotic approach toward 95% if Gemini takes longer than 16s
        const extra = elapsed - current.atMs;
        const asymptotic = current.targetPct + (96 - current.targetPct) * (1 - Math.exp(-extra / 12000));
        setProgressPct((prev) => Math.max(prev, Math.min(96, Math.round(asymptotic))));
      }
    };

    tick();
    const timer = window.setInterval(tick, 300);
    return () => window.clearInterval(timer);
  }, [isLoading, startedAtMs, phases]);

  const handleCancel = () => {
    if (!inFlight.current) return;
    inFlight.current.abort();
    inFlight.current = null;
    setIsLoading(false);
    setStartedAtMs(null);
    setProgressPct(0);
    setActivePhaseIdx(0);
  };

  const handleGenerate = async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setIsLoading(true);
    setStartedAtMs(Date.now());
    setProgressPct(8);
    setActivePhaseIdx(0);
    setErrorMessage(null);

    try {
      if (repoAnalysis) {
        // Contextual task generation grounded on analyzed repository
        const res = await taskService.generateTaskFromRepo({
          snapshot_id: repoAnalysis.snapshot_id ?? undefined,
          repo_analysis: repoAnalysis,
          options: {
            difficulty,
            category,
            focus_area: focusArea.trim() || undefined,
          },
        }, controller.signal);
        if (!controller.signal.aborted) {
          setProgressPct(100);
          setTask(res);
        }
      } else {
        // Standalone topic task generation
        const res = await taskService.generateTopicTask({
          topic: focusArea.trim() || 'Build a scalable REST microservice with unit tests',
          difficulty,
          category,
          language: 'python',
        }, controller.signal);
        if (!controller.signal.aborted) {
          setProgressPct(100);
          setTask(res);
        }
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const msg = (err as { message?: string })?.message || 'Failed to generate task.';
      setErrorMessage(msg);
    } finally {
      inFlight.current = null;
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setStartedAtMs(null);
      }
    }
  };

  const progressSteps: JobProgressStep[] = phases.map((phase, idx) => ({
    id: phase.id,
    label: phase.label,
    status: idx < activePhaseIdx ? 'completed' : idx === activePhaseIdx ? 'running' : 'pending',
    detail: idx === activePhaseIdx ? 'In progress' : idx < activePhaseIdx ? 'Done' : null,
  }));

  const currentPhase = phases[activePhaseIdx] || phases[0];

  return (
    <div>
      <PageHeader
        title="Contextual Task Generator"
        description="Ground tasks directly on repository architecture, dependencies, and starting commit SHA using Gemini AI."
      />

      {/* Repository Context Banner */}
      {!repoAnalysis && (
        <div
          className="card"
          style={{
            padding: '16px',
            marginBottom: '20px',
            backgroundColor: 'var(--warning-light)',
            borderColor: 'var(--warning-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 220px' }}>
            <AlertCircle size={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: 'var(--warning-text)' }}>
              No repository analyzed yet. Tasks will be synthesized in standalone mode. For grounded tasks, ingest a repository first.
            </span>
          </div>
          <Link to="/new-project" className="btn btn-secondary" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
            Ingest Repo
          </Link>
        </div>
      )}

      {/* Generator Configuration Form */}
      <div className="card workflow-panel" style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders size={16} />
          <span>Task Generation Parameters</span>
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '16px', marginBottom: '8px' }}>
          {/* Difficulty */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Difficulty Level
            </label>
            <select
              className="input"
              value={difficulty}
              disabled={isLoading}
              onChange={(e) => setDifficulty(e.target.value as TaskDifficulty)}
            >
              <option value="easy">Easy (Targeted fix or small helper)</option>
              <option value="medium">Medium (Component or API feature)</option>
              <option value="hard">Hard (Subsystem or architectural change)</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Task Category
            </label>
            <select
              className="input"
              value={category}
              disabled={isLoading}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="backend">Backend & API</option>
              <option value="frontend">Frontend & UI</option>
              <option value="fullstack">Fullstack Application</option>
              <option value="devops">DevOps & Tooling</option>
              <option value="data">Data Processing & Pipeline</option>
            </select>
          </div>

          {/* Focus Area */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Specific Focus Area or Feature Goal (Optional)
            </label>
            <input
              type="text"
              className="input"
              disabled={isLoading}
              placeholder="e.g. Implement Redis caching with 60s TTL on items endpoint"
              value={focusArea}
              onChange={(e) => setFocusArea(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="btn btn-primary"
          >
            <Sparkles size={14} />
            <span>{isLoading ? 'Synthesizing Task...' : 'Generate Contextual Task'}</span>
          </button>
        </div>
      </div>

      {/* Live Progress Bar & Error States */}
      {isLoading && (
        <AgentProgressBar
          title={
            repoAnalysis
              ? `Generating contextual task for ${repoAnalysis.project_name}`
              : 'Generating standalone coding task'
          }
          stage={currentPhase.label}
          detail={currentPhase.detail}
          percent={progressPct}
          completedSteps={activePhaseIdx}
          totalSteps={phases.length}
          steps={progressSteps}
          startedAtMs={startedAtMs}
          onCancel={handleCancel}
          cancelLabel="Cancel"
        />
      )}

      {errorMessage && (
        <div style={{ marginBottom: '28px' }}>
          <ErrorState
            title="Task Generation Failed"
            message={errorMessage}
            onRetry={handleGenerate}
          />
        </div>
      )}

      {/* Generated Task Preview */}
      {task && !isLoading && (
        <div className="card workflow-panel">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 240px' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
                <StatusBadge status={task.difficulty} />
                <span className="badge badge-default">{task.category}</span>
                <span className="badge badge-default">{task.language}</span>
                {task.starting_commit_sha && (
                  <span className="code-inline" title="Starting Git Commit SHA">
                    SHA: {task.starting_commit_sha.slice(0, 8)}
                  </span>
                )}
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {task.title}
              </h3>
            </div>

            <button
              onClick={() => navigate('/solution')}
              className="btn btn-primary"
            >
              <span>Proceed to Solution Engine</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {task.description}
          </div>

          {/* Two-column: Requirements and Acceptance Criteria */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '16px', marginBottom: '12px' }}>
            {/* Functional Requirements */}
            <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Functional Requirements
              </div>
              <ul style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                {task.requirements.map((req, i) => (
                  <li key={i}>{req}</li>
                ))}
              </ul>
            </div>

            {/* Acceptance Criteria */}
            <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                Acceptance Criteria
              </div>
              <ul style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                {task.acceptance_criteria.map((crit, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                    <CheckCircle size={13} style={{ color: 'var(--success)', marginTop: '2px', flexShrink: 0 }} />
                    <span>{crit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Relevant Files */}
          {task.relevant_files && task.relevant_files.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                Suggested Target Files
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {task.relevant_files.map((file, i) => (
                  <span key={i} className="code-inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <FileCode size={11} />
                    <span>{file}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
