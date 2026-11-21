import React from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface WorkflowStep {
  id: string;
  name: string;
  path: string;
  isCompleted: boolean;
  isActive: boolean;
}

interface WorkflowStepperProps {
  steps: WorkflowStep[];
}

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ steps }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        overflowX: 'auto',
        padding: '6px 4px',
        marginBottom: '20px',
      }}
    >
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;

        let badgeBg = 'var(--bg-muted)';
        let badgeColor = 'var(--text-muted)';
        let borderColor = 'var(--border-default)';

        if (step.isActive) {
          badgeBg = 'var(--accent-primary-light)';
          badgeColor = 'var(--accent-primary)';
          borderColor = 'var(--accent-primary-border)';
        } else if (step.isCompleted) {
          badgeBg = 'var(--success-light)';
          badgeColor = 'var(--success-text)';
          borderColor = 'var(--success-border)';
        }

        return (
          <React.Fragment key={step.id}>
            <Link
              to={step.path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: badgeBg,
                color: badgeColor,
                border: `1px solid ${borderColor}`,
                fontSize: '12px',
                fontWeight: step.isActive ? 600 : 500,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  backgroundColor: step.isCompleted ? 'var(--success)' : step.isActive ? 'var(--accent-primary)' : 'var(--border-strong)',
                  color: '#ffffff',
                }}
              >
                {step.isCompleted ? <Check size={10} strokeWidth={3} /> : idx + 1}
              </div>
              <span>{step.name}</span>
            </Link>

            {!isLast && (
              <ArrowRight size={12} style={{ color: 'var(--border-strong)', flexShrink: 0 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
