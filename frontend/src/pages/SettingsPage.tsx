import React, { useState } from 'react';
import {
  Server,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Moon,
  Sun,
  LogOut,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { useProject } from '../context/ProjectContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

export const SettingsPage: React.FC = () => {
  const { backendHealth, checkBackendHealth, resetProject } = useProject();
  const { theme, setTheme } = useTheme();
  const { user, profileSynced, cloudSummary, signOut } = useAuth();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isProbing, setIsProbing] = useState(false);

  const handleProbe = async () => {
    setIsProbing(true);
    await checkBackendHealth();
    setIsProbing(false);
  };

  const handleConfirmReset = () => {
    resetProject();
    setIsResetDialogOpen(false);
  };

  const providerLabel = user?.providerData.some((p) => p.providerId === 'github.com')
    ? 'GitHub'
    : 'Google';

  return (
    <div>
      <PageHeader
        title="Settings & Account"
        description="Manage your signed-in account, appearance theme, backend connectivity, and session state."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px' }}>
        {/* Account & Per-User Data Isolation Card */}
        {user && (
          <div className="card" style={{ padding: '20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User avatar'}
                    referrerPolicy="no-referrer"
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-full)',
                      objectFit: 'cover',
                      border: '1px solid var(--border-default)',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: 'var(--bg-muted)',
                      border: '1px solid var(--border-default)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <UserIcon size={18} />
                  </div>
                )}

                <div>
                  <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {user.displayName || 'MIRAI User'}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {user.email || 'Signed in via OAuth'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void signOut()}
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                <LogOut size={13} />
                <span>Sign Out</span>
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-default)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '4px 0',
                }}
              >
                <span>Sign-In Provider</span>
                <span className="badge badge-accent">{providerLabel}</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '4px 0',
                }}
              >
                <span>Personal User ID</span>
                <code className="code-inline">{user.uid}</code>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '4px 0',
                }}
              >
                <span>Cloud Account Sync</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--success-text)',
                    fontWeight: 500,
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>
                    {profileSynced
                      ? `Active (${cloudSummary.projects} projects, ${cloudSummary.tasks} tasks synced)`
                      : 'Private workspace isolated to your User ID'}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Appearance / Theme Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Appearance
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Switch between Light mode and the Charcoal Dark theme (light black, neutral grey, and crisp white).
              </p>
            </div>

            <div
              role="group"
              aria-label="Theme selection"
              style={{
                display: 'inline-flex',
                gap: '4px',
                padding: '4px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-muted)',
                border: '1px solid var(--border-default)',
              }}
            >
              <button
                type="button"
                onClick={() => setTheme('light')}
                className="btn"
                aria-pressed={theme === 'light'}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: theme === 'light' ? 'var(--bg-card)' : 'transparent',
                  color: theme === 'light' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: theme === 'light' ? 'var(--shadow-xs)' : 'none',
                }}
              >
                <Sun size={14} />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className="btn"
                aria-pressed={theme === 'dark'}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: theme === 'dark' ? 'var(--bg-card)' : 'transparent',
                  color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: theme === 'dark' ? 'var(--shadow-xs)' : 'none',
                }}
              >
                <Moon size={14} />
                <span>Dark</span>
              </button>
            </div>
          </div>
        </div>

        {/* Backend Connectivity Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 200px' }}>
              <Server size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Backend Server Connection
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                  Target: {typeof window !== 'undefined' ? window.location.origin : 'Same-origin API'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: backendHealth === 'online' ? 'var(--success-light)' : 'var(--danger-light)',
                  border: `1px solid ${backendHealth === 'online' ? 'var(--success-border)' : 'var(--danger-border)'}`,
                  color: backendHealth === 'online' ? 'var(--success-text)' : 'var(--danger-text)',
                  fontSize: '11px',
                  fontWeight: 500,
                }}
              >
                {backendHealth === 'online' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                <span>{backendHealth === 'online' ? 'Connected' : 'Disconnected'}</span>
              </div>

              <button
                onClick={handleProbe}
                disabled={isProbing}
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                <span>{isProbing ? 'Probing...' : 'Test Connection'}</span>
              </button>
            </div>
          </div>

          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            All operations (repository analysis, AI synthesis, validation gates, and Harbor export) are authenticated with your user account and stored privately under your ID.
          </p>
        </div>

        {/* Runtime Standards Card */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <Cpu size={18} style={{ color: 'var(--info)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Evaluation Engine Standards
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
              <span>Target Benchmark Format</span>
              <strong style={{ color: 'var(--text-primary)' }}>Harbor Schema 1.4</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
              <span>Evaluation Verifier Protocol</span>
              <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>/logs/verifier/reward.txt (1.0 / 0.0)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
              <span>Code Execution Boundary</span>
              <strong style={{ color: 'var(--text-primary)' }}>Docker containers</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 0' }}>
              <span>AI Providers</span>
              <strong style={{ color: 'var(--text-primary)' }}>Gemini · Groq · Adaption AI</strong>
            </div>
          </div>
        </div>

        {/* Clear Selection State */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ flex: '1 1 220px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Clear Active Selection
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Deselects the active task and repository. Saved work stays in your dashboard.
              </p>
            </div>

            <button
              onClick={() => setIsResetDialogOpen(true)}
              className="btn btn-secondary"
              style={{ color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }}
            >
              <RotateCcw size={13} />
              <span>Clear Selection</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isResetDialogOpen}
        title="Clear active selection?"
        message="You can reopen saved work from the dashboard."
        confirmLabel="Clear Selection"
        cancelLabel="Keep Active"
        isDestructive
        onConfirm={handleConfirmReset}
        onCancel={() => setIsResetDialogOpen(false)}
      />
    </div>
  );
};
