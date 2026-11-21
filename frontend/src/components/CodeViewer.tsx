import React, { useState } from 'react';
import { Check, Copy, FileCode } from 'lucide-react';

interface CodeViewerProps {
  code: string;
  language?: string;
  filePath?: string;
  maxHeight?: string;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  code,
  language = 'python',
  filePath,
  maxHeight = '420px',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');

  return (
    <div
      className="card"
      style={{
        overflow: 'hidden',
        border: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-code)',
      }}
    >
      {/* File / language header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-code-header)',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', minWidth: 0, flex: '1 1 160px' }}>
          <FileCode size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={filePath || undefined}
          >
            {filePath || `snippet.${language === 'python' ? 'py' : language === 'typescript' ? 'ts' : 'txt'}`}
          </span>
          {language && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', flexShrink: 0 }}>
              ({language})
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="btn btn-subtle"
          style={{ padding: '4px 10px', fontSize: '11px', minHeight: '30px', flexShrink: 0 }}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} style={{ color: 'var(--success)' }} />
              <span style={{ color: 'var(--success-text)' }}>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code body with line numbers */}
      <div
        style={{
          maxHeight,
          overflowY: 'auto',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '12px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: '1.6',
          color: 'var(--text-code)',
          backgroundColor: 'var(--bg-code)',
          display: 'flex',
        }}
      >
        {/* Line numbers */}
        <div
          style={{
            userSelect: 'none',
            textAlign: 'right',
            padding: '0 8px',
            color: 'var(--text-muted)',
            borderRight: '1px solid var(--border-subtle)',
            minWidth: '34px',
            fontSize: '11px',
            flexShrink: 0,
          }}
        >
          {lines.map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>

        {/* Code content */}
        <pre
          style={{
            flex: 1,
            minWidth: 0,
            margin: 0,
            padding: '0 12px',
            overflowX: 'auto',
            fontFamily: 'inherit',
          }}
        >
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
};
