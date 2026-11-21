import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  subtext?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  subtext,
}) => {
  return (
    <div
      style={{
        padding: '64px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <Loader2
        size={28}
        className="animate-spin"
        style={{ color: 'var(--accent-primary)', marginBottom: '16px', animation: 'spin 1s linear infinite' }}
      />
      <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
        {message}
      </h4>
      {subtext && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '360px' }}>
          {subtext}
        </p>
      )}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
