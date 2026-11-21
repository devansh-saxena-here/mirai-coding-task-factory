import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from '../components/AppSidebar';
import { TopNavbar } from '../components/TopNavbar';
import { WorkflowJob } from '../components/WorkflowJob';

const MOBILE_QUERY = '(max-width: 900px)';

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.title = 'MIRAI — Workspace';
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) {
        setMobileMenuOpen(false);
      }
    };
    setIsMobile(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Automatically close the mobile navigation drawer when switching routes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close drawer on Escape and lock background scroll while open on mobile
  useEffect(() => {
    if (!isMobile || !mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, mobileMenuOpen]);

  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileMenuOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', maxWidth: '100vw' }}>
      {/* Mobile Off-Canvas Backdrop */}
      {isMobile && mobileMenuOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar (sticky collapsible on desktop, slide-over drawer on mobile) */}
      <AppSidebar
        isCollapsed={isMobile ? false : sidebarCollapsed}
        isMobile={isMobile}
        isOpen={isMobile ? mobileMenuOpen : true}
        onToggleCollapse={handleToggleSidebar}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
        <TopNavbar onToggleSidebar={handleToggleSidebar} isMobileMenuOpen={isMobile && mobileMenuOpen} />

        <main
          className="workflow-main"
          style={{
            flex: 1,
            padding: '28px 32px',
            maxWidth: '1280px',
            width: '100%',
            margin: '0 auto',
          }}
        >
          <WorkflowJob />
          <Outlet />
        </main>
      </div>
    </div>
  );
};
