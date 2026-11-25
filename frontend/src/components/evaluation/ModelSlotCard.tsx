import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import {
  findModelSpec,
  MODEL_PRESETS_BY_SLOT,
  ModelInfoTooltip,
} from '../ModelInfoTooltip';

export interface ModelSlot {
  id: 'gemini' | 'gpt_oss' | 'qwen';
  label: string;
  displayName: string;
  family: string;
  provider: 'gemini' | 'groq' | 'adaption';
  enabled: boolean;
  model: string;
  placeholder: string;
  customMode?: boolean;
}

export interface SlotReadiness {
  tone: 'success' | 'warning' | 'muted';
  text: string;
}

interface ModelSlotCardProps {
  slot: ModelSlot;
  index: number;
  status: SlotReadiness;
  onToggle: (slotId: ModelSlot['id']) => void;
  onSelectPreset: (slotId: ModelSlot['id'], value: string) => void;
  onUpdateModel: (slotId: ModelSlot['id'], value: string) => void;
}

export function ModelSlotCard({
  slot,
  index,
  status,
  onToggle,
  onSelectPreset,
  onUpdateModel,
}: ModelSlotCardProps) {
  const statusColor =
    status.tone === 'success'
      ? 'var(--success-text)'
      : status.tone === 'warning'
        ? 'var(--warning-text)'
        : 'var(--text-muted)';

  const presets = MODEL_PRESETS_BY_SLOT[slot.id];
  const matchedPreset = presets.find(
    (preset) => preset.id.toLowerCase() === slot.model.trim().toLowerCase()
  );
  const isCustom = Boolean(slot.customMode || !matchedPreset);
  const dropdownValue = isCustom ? '__custom__' : matchedPreset!.id;
  const activeSpec = findModelSpec(slot.model);

  return (
    <div
      style={{
        padding: '14px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${slot.enabled ? 'var(--border-strong)' : 'var(--border-default)'}`,
        backgroundColor: slot.enabled ? 'var(--bg-card)' : 'var(--bg-muted)',
        opacity: slot.enabled ? 1 : 0.72,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        transition: 'border-color 0.15s ease, opacity 0.15s ease',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={() => onToggle(slot.id)}
            style={{
              width: '18px',
              height: '18px',
              accentColor: 'var(--accent-primary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {index + 1}. {slot.displayName}
          </span>
        </span>
        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{slot.family}</span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="model-select-label-row">
          <label
            htmlFor={`model-select-${slot.id}`}
            style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}
          >
            Model selection
          </label>
          <ModelInfoTooltip
            slotId={slot.id}
            selectedModelId={slot.model}
            slotDisplayName={slot.displayName}
          />
        </div>

        <select
          id={`model-select-${slot.id}`}
          value={dropdownValue}
          disabled={!slot.enabled}
          onChange={(e) => onSelectPreset(slot.id, e.target.value)}
          title={
            activeSpec
              ? `${activeSpec.label} — ${activeSpec.parameters} · ${activeSpec.contextWindow} context. ${activeSpec.bestFor}`
              : `Custom model identifier (${slot.model || slot.placeholder})`
          }
          style={{
            fontSize: '12.5px',
            width: '100%',
          }}
        >
          {presets.map((preset) => (
            <option
              key={preset.id}
              value={preset.id}
              title={`${preset.parameters} · ${preset.contextWindow} · ${preset.bestFor}`}
            >
              {preset.label}
            </option>
          ))}
          <option value="__custom__">Custom model identifier…</option>
        </select>

        {isCustom ? (
          <input
            aria-label={`${slot.displayName} custom model identifier`}
            value={slot.model}
            maxLength={140}
            disabled={!slot.enabled}
            placeholder={slot.placeholder}
            onChange={(e) => onUpdateModel(slot.id, e.target.value)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              width: '100%',
            }}
          />
        ) : activeSpec ? (
          <div className="model-spec-caption">
            <span>{activeSpec.parameters}</span>
            <span>· {activeSpec.contextWindow} context</span>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11.5px',
          color: statusColor,
          fontWeight: 500,
        }}
      >
        {status.tone === 'success' ? (
          <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
        ) : status.tone === 'warning' ? (
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
        ) : (
          <Info size={13} style={{ flexShrink: 0 }} />
        )}
        <span>{status.text}</span>
      </div>
    </div>
  );
}
