import React from 'react';
import { CheckCircle2, XCircle, Clock, ShieldCheck, ShieldAlert } from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const s = (status || '').toUpperCase();

  const getStyleAndIcon = () => {
    switch (s) {
      case 'VALIDATED':
        return {
          className: 'badge-success',
          icon: <ShieldCheck size={12} />,
          label: 'VALIDATED',
        };
      case 'NOT_VALIDATED':
        return {
          className: 'badge-warning',
          icon: <ShieldAlert size={12} />,
          label: 'NOT VALIDATED',
        };
      case 'REJECTED':
      case 'FAILED':
        return {
          className: 'badge-danger',
          icon: <XCircle size={12} />,
          label: s,
        };
      case 'COMPLETED':
      case 'PASSED':
        return {
          className: 'badge-success',
          icon: <CheckCircle2 size={12} />,
          label: s,
        };
      case 'PENDING':
      case 'RUNNING':
        return {
          className: 'badge-info',
          icon: <Clock size={12} className="animate-spin" />,
          label: s,
        };
      case 'CREATE':
        return {
          className: 'badge-accent',
          icon: null,
          label: 'CREATE',
        };
      case 'MODIFY':
        return {
          className: 'badge-default',
          icon: null,
          label: 'MODIFY',
        };
      case 'EASY':
        return {
          className: 'badge-success',
          icon: null,
          label: 'EASY',
        };
      case 'MEDIUM':
        return {
          className: 'badge-warning',
          icon: null,
          label: 'MEDIUM',
        };
      case 'HARD':
        return {
          className: 'badge-danger',
          icon: null,
          label: 'HARD',
        };
      default:
        return {
          className: 'badge-default',
          icon: null,
          label: status,
        };
    }
  };

  const { className, icon, label } = getStyleAndIcon();
  const padding = size === 'sm' ? '1px 6px' : '2px 8px';
  const fontSize = size === 'sm' ? '10px' : '11px';

  return (
    <span
      className={`badge ${className}`}
      style={{ padding, fontSize, letterSpacing: '0.02em' }}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};
