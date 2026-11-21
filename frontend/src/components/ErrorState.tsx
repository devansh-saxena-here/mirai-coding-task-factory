import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'An error occurred',
  message,
  onRetry,
}) => {
  return (
    <div
      className="card"
      style={{
        padding: '32px 24px',
        textAlign: 'center',
        borderColor: 'var(--danger-border)',
        backgroundColor: 'var(--danger-light)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--danger-light)',
          border: '1px solid var(--danger-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--danger)',
          marginBottom: '12px',
        }}
      >
        <AlertCircle size={20} />
      </div>
      <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--danger-text)', marginBottom: '4px' }}>
        {title}
      </h4>
      <p style={{ fontSize: '13px', color: 'var(--danger-text)', maxWidth: '460px', marginBottom: onRetry ? '16px' : '0', opacity: 0.9 }}>
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn btn-secondary"
          style={{ fontSize: '12px', borderColor: 'var(--danger-border)', color: 'var(--danger-text)' }}
        >
          <RefreshCw size={13} />
          Try Again
        </button>
      )}
    </div>
  );
};
