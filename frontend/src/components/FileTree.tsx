import React from 'react';
import { File, Folder, ChevronRight } from 'lucide-react';

interface FileTreeProps {
  files: string[];
  selectedFile?: string;
  onSelectFile?: (file: string) => void;
  maxDisplay?: number;
}

export const FileTree: React.FC<FileTreeProps> = ({
  files,
  selectedFile,
  onSelectFile,
  maxDisplay = 50,
}) => {
  const displayedFiles = files.slice(0, maxDisplay);

  return (
    <div
      className="card"
      style={{
        padding: '8px',
        backgroundColor: 'var(--bg-card)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        maxHeight: '320px',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: '6px 8px', fontSize: '11px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
        <span>FILES & DIRECTORIES</span>
        <span>{files.length} items</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {displayedFiles.map((path, idx) => {
          const isSelected = selectedFile === path;
          const isDir = path.endsWith('/') || !path.includes('.');

          return (
            <div
              key={idx}
              onClick={() => onSelectFile && onSelectFile(path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isSelected ? 'var(--accent-primary-light)' : 'transparent',
                color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: onSelectFile ? 'pointer' : 'default',
                transition: 'background-color 0.1s ease',
              }}
              onMouseEnter={(e) => {
                if (!isSelected && onSelectFile) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {isDir ? (
                <Folder size={13} style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <File size={13} style={{ color: 'var(--text-muted)' }} />
              )}
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {path}
              </span>
              {isSelected && <ChevronRight size={12} />}
            </div>
          );
        })}
      </div>

      {files.length > maxDisplay && (
        <div style={{ padding: '8px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
          + {files.length - maxDisplay} more files
        </div>
      )}
    </div>
  );
};
