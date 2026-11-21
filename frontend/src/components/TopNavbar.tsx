import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, Menu, User } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from './ThemeToggle';

interface TopNavbarProps {
  onToggleSidebar?: () => void;
  isMobileMenuOpen?: boolean;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  onToggleSidebar,
  isMobileMenuOpen = false,
}) => {
  const location = useLocation();
  const { backendHealth, checkBackendHealth } = useProject();
  const { user, signOut } = useAuth();

  const getPageTitle = (path: string): string => {
    switch (path) {
      case '/dashboard':
        return 'Dashboard';
      case '/new-project':
        return 'New Project';
      case '/analysis':
        return 'Repository Analysis';
      case '/task-generator':
        return 'Task Generator';
      case '/solution':
        return 'Reference Solution';
      case '/test-suite':
        return 'Test Suite';
      case '/validation':
        return 'Validation';
      case '/export':
        return 'Harbor Export';
      case '/evaluation':
        return 'Agent Evaluation';
      case '/leaderboard':
        return 'Model Leaderboard';
      case '/settings':
        return 'Settings';
      default:
        return 'MIRAI';
    }
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <header className="top-navbar">
      <div className="top-navbar-left">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="btn btn-subtle top-navbar-menu-btn"
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
            title="Toggle navigation"
          >
            <Menu size={18} />
          </button>
        )}

        <div className="top-navbar-breadcrumb">
          <Link to="/" className="top-navbar-brand-crumb">
            MIRAI
          </Link>
          <span className="top-navbar-crumb-sep" aria-hidden="true">/</span>
          <span className="top-navbar-page-title">
            {getPageTitle(location.pathname)}
          </span>
        </div>
      </div>

      <div className="top-navbar-right">
        <ThemeToggle />

        {/* Backend Connectivity Status Indicator */}
        <button
          type="button"
          onClick={() => void checkBackendHealth()}
          className="top-navbar-health"
          title={`Backend ${backendHealth} — click to re-check`}
          aria-label={`Backend status: ${backendHealth}. Click to probe.`}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: 'var(--radius-full)',
              flexShrink: 0,
              backgroundColor:
                backendHealth === 'online'
                  ? 'var(--success)'
                  : backendHealth === 'checking'
                    ? 'var(--warning)'
                    : 'var(--danger)',
              boxShadow:
                backendHealth === 'online' ? '0 0 0 2px rgba(16, 185, 129, 0.2)' : 'none',
            }}
          />
          <span className="mobile-hide-label" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {backendHealth === 'online'
              ? 'Online'
              : backendHealth === 'checking'
                ? 'Checking...'
                : 'Offline'}
          </span>
        </button>

        {/* Signed-in User Chip */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Link
              to="/settings"
              className="top-navbar-user-chip"
              title={`${displayName}${user.email ? ` (${user.email})` : ''} — Manage account`}
              aria-label={`Account settings for ${displayName}`}
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: 'var(--radius-full)',
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--accent-primary-light)',
                    color: 'var(--accent-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initials || <User size={13} />}
                </span>
              )}
              <span className="top-navbar-user-name mobile-hide-label">
                {displayName}
              </span>
            </Link>

            <button
              type="button"
              onClick={() => void signOut()}
              className="btn btn-secondary top-navbar-signout"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
              <span className="mobile-hide-label">Sign out</span>
            </button>
          </div>
        ) : (
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--bg-muted)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
            title="User Profile"
          >
            <User size={15} />
          </div>
        )}
      </div>
    </header>
  );
};
