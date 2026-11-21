import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderPlus,
  GitBranch,
  Sparkles,
  Code2,
  CheckSquare,
  ShieldCheck,
  ChartNoAxesCombined,
  Trophy,
  Package,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { useProject } from '../context/ProjectContext';

interface AppSidebarProps {
  isCollapsed: boolean;
  isMobile?: boolean;
  isOpen?: boolean;
  onToggleCollapse: () => void;
  onCloseMobile?: () => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isCollapsed,
  isMobile = false,
  isOpen = true,
  onToggleCollapse,
  onCloseMobile,
}) => {
  const { repoAnalysis, task, solution, testSuite, validationReport } = useProject();

  const navigation = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'New Project', path: '/new-project', icon: FolderPlus },
    {
      name: 'Repository Analysis',
      path: '/analysis',
      icon: GitBranch,
      hasData: Boolean(repoAnalysis),
    },
    {
      name: 'Task Generator',
      path: '/task-generator',
      icon: Sparkles,
      hasData: Boolean(task),
    },
    {
      name: 'Reference Solution',
      path: '/solution',
      icon: Code2,
      hasData: Boolean(solution),
    },
    {
      name: 'Test Suite',
      path: '/test-suite',
      icon: CheckSquare,
      hasData: Boolean(testSuite),
    },
    {
      name: 'Validation',
      path: '/validation',
      icon: ShieldCheck,
      hasData: Boolean(validationReport),
    },
    {
      name: 'Harbor Export',
      path: '/export',
      icon: Package,
    },
    { name: 'Agent Evaluation', path: '/evaluation', icon: ChartNoAxesCombined },
    { name: 'Model Leaderboard', path: '/leaderboard', icon: Trophy },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const collapsed = isMobile ? false : isCollapsed;

  return (
    <aside
      aria-label="Workspace navigation"
      aria-hidden={isMobile && !isOpen ? true : undefined}
      style={{
        width: isMobile
          ? 'min(284px, 84vw)'
          : collapsed
            ? 'var(--sidebar-collapsed-width)'
            : 'var(--sidebar-width)',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        transition: isMobile
          ? 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
          : 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        flexShrink: 0,
        height: isMobile ? '100dvh' : '100vh',
        position: isMobile ? 'fixed' : 'sticky',
        top: 0,
        left: 0,
        transform: isMobile ? (isOpen ? 'translateX(0)' : 'translateX(-105%)') : 'none',
        boxShadow: isMobile && isOpen ? 'var(--shadow-lg)' : 'none',
        zIndex: isMobile ? 70 : 50,
        pointerEvents: isMobile && !isOpen ? 'none' : 'auto',
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          height: 'var(--topbar-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '0' : '0 16px',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <Link
          to="/"
          aria-label="MIRAI home"
          onClick={() => isMobile && onCloseMobile?.()}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}
        >
          <img
            src="/mirai-logo.jpg"
            alt="MIRAI"
            width={collapsed ? 30 : 36}
            height={collapsed ? 30 : 36}
            style={{
              objectFit: 'contain',
              flexShrink: 0,
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              padding: '2px',
            }}
          />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 750,
                  letterSpacing: '.06em',
                  color: 'var(--brand-wordmark)',
                  lineHeight: 1.2,
                }}
              >
                MIRAI
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Coding evaluation workspace
              </div>
            </div>
          )}
        </Link>

        {isMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            className="btn btn-subtle"
            style={{ minWidth: '40px', minHeight: '40px', padding: '8px', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close navigation menu"
            title="Close menu"
          >
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="btn btn-subtle"
            style={{ padding: '6px', borderRadius: 'var(--radius-sm)' }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        )}
      </div>

      {/* Navigation List */}
      <nav
        style={{
          flex: 1,
          padding: '12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? '4px' : '2px',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {navigation.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => isMobile && onCloseMobile?.()}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: collapsed ? '9px 0' : isMobile ? '11px 12px' : '9px 12px',
                minHeight: isMobile ? '44px' : undefined,
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 'var(--radius-md)',
                fontSize: isMobile ? '14px' : '13px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--accent-primary-light)' : 'transparent',
                textDecoration: 'none',
                position: 'relative',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              })}
              title={collapsed ? item.name : undefined}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={17}
                    style={{
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      flexShrink: 0,
                    }}
                  />
                  {!collapsed && (
                    <span
                      style={{
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.name}
                    </span>
                  )}
                  {!collapsed && item.hasData && (
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--accent-primary)',
                        flexShrink: 0,
                      }}
                      title="Data available"
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Active Project Footer in Sidebar */}
      {!collapsed && repoAnalysis && (
        <div
          style={{
            padding: '12px 14px',
            margin: '8px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-muted)',
            border: '1px solid var(--border-default)',
            fontSize: '11px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: 'var(--text-muted)',
              marginBottom: '2px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Active Repo
          </div>
          <div
            style={{
              fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {repoAnalysis.project_name}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
            {repoAnalysis.detected_languages[0] || 'Unknown'} · {repoAnalysis.file_count} files
          </div>
        </div>
      )}
    </aside>
  );
};
