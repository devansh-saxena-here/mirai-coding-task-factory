import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from './LoadingState';
import { ThemeToggle } from './ThemeToggle';

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.29A7.19 7.19 0 0 1 4.91 12c0-.8.14-1.57.38-2.29V6.61H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1c.94-2.84 3.59-4.95 6.71-4.95Z"
      />
    </svg>
  );
}

function GithubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
      />
    </svg>
  );
}

export function AuthGate({ children }: PropsWithChildren) {
  const {
    user,
    authReady,
    signingInProvider,
    authError,
    signInWithGoogle,
    signInWithGithub,
  } = useAuth();

  if (!authReady) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-app)',
          padding: '24px',
        }}
      >
        <LoadingState message="Checking your MIRAI session…" />
      </main>
    );
  }

  if (user) {
    return <>{children}</>;
  }

  const busy = signingInProvider !== null;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-app)',
        color: 'var(--text-primary)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 600,
            minHeight: '40px',
            color: 'var(--text-primary)',
          }}
        >
          <ArrowLeft size={15} />
          <span>MIRAI</span>
        </Link>
        <ThemeToggle />
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 14px',
        }}
      >
        <section
          className="card"
          style={{
            width: '100%',
            maxWidth: '430px',
            padding: 'clamp(18px, 5vw, 28px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--accent-primary-light)',
                  border: '1px solid var(--accent-primary-border)',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShieldCheck size={17} />
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}
              >
                Workspace Access
              </span>
            </div>

            <h1
              style={{
                fontSize: '22px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--text-primary)',
                marginTop: '4px',
              }}
            >
              Sign in or create an account
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}
            >
              Continue with Google or GitHub to access your private MIRAI workspace. Every
              repository, task, solution, test suite, and Harbor export stays saved under your
              personal user ID.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--danger-light)',
                border: '1px solid var(--danger-border)',
                color: 'var(--danger-text)',
                fontSize: '12.5px',
                lineHeight: 1.45,
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{authError}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void signInWithGoogle()}
              className="btn btn-secondary"
              style={{
                width: '100%',
                height: '44px',
                fontSize: '13.5px',
                fontWeight: 600,
                justifyContent: 'center',
              }}
            >
              {signingInProvider === 'google' ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <GoogleLogo />
              )}
              <span>
                {signingInProvider === 'google'
                  ? 'Signing in with Google…'
                  : 'Continue with Google'}
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void signInWithGithub()}
              className="btn btn-secondary"
              style={{
                width: '100%',
                height: '44px',
                fontSize: '13.5px',
                fontWeight: 600,
                justifyContent: 'center',
              }}
            >
              {signingInProvider === 'github' ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <GithubLogo />
              )}
              <span>
                {signingInProvider === 'github'
                  ? 'Signing in with GitHub…'
                  : 'Continue with GitHub'}
              </span>
            </button>
          </div>

          <div
            style={{
              paddingTop: '14px',
              borderTop: '1px solid var(--border-default)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            New users are registered automatically on first sign-in. Your data is isolated to your
            account ID and never shared with other users.
          </div>
        </section>
      </main>
    </div>
  );
}
