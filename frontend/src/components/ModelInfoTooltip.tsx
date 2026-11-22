import { useEffect, useId, useRef, useState } from 'react';
import { Cpu, Info, Layers, Sparkles } from 'lucide-react';

export interface ModelSpec {
  id: string;
  label: string;
  provider: 'gemini' | 'groq' | 'adaption';
  parameters: string;
  architecture: string;
  contextWindow: string;
  strengths: string[];
  bestFor: string;
}

export const MODEL_PRESETS_BY_SLOT: Record<'gemini' | 'gpt_oss' | 'qwen', ModelSpec[]> = {
  gemini: [
    {
      id: 'gemini/gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen (Default)',
      provider: 'gemini',
      parameters: 'Frontier Proprietary (Undisclosed)',
      architecture: 'Multimodal Transformer · Fast Reasoning',
      contextWindow: '1M tokens',
      strengths: [
        'Fast, reliable multi-file patch synthesis with high JSON schema adherence',
        'Strong balance of coding accuracy and low turn latency across Python & TypeScript',
        'Handles full repository context alongside protected-test guard constraints',
      ],
      bestFor: 'Default Stage 5 benchmark baseline across general feature-development tasks.',
    },
    {
      id: 'gemini/gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: 'gemini',
      parameters: 'Frontier Flagship (Proprietary · Deep Thinking)',
      architecture: 'Multimodal Reasoning Transformer',
      contextWindow: '1M tokens',
      strengths: [
        'Deep multi-step architectural reasoning and complex edge-case analysis',
        'High first-pass solve rate on multi-module refactors and algorithmic specs',
        'Large 1M-token window keeps extensive repository files and test contracts in view',
      ],
      bestFor: 'Hard-difficulty benchmarks requiring deeper codebase reasoning.',
    },
    {
      id: 'gemini/gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      provider: 'gemini',
      parameters: 'Lightweight Frontier (Proprietary · Low Latency)',
      architecture: 'Efficiency-Optimized Transformer',
      contextWindow: '1M tokens',
      strengths: [
        'Low-latency generation ideal for multi-repeat evaluation campaigns',
        'High token efficiency with strong instruction following for scoped edits',
        'Retains 1M-token context while minimizing wall-clock benchmark duration',
      ],
      bestFor: 'Rapid multi-repeat campaigns and latency-sensitive comparisons.',
    },
  ],
  gpt_oss: [
    {
      id: 'groq/openai/gpt-oss-120b',
      label: 'GPT-OSS 120B (Default)',
      provider: 'groq',
      parameters: '120B total · ~5.1B active',
      architecture: 'Open-Weight Mixture-of-Experts (MoE) · Groq LPU',
      contextWindow: '128K tokens',
      strengths: [
        'Ultra-fast token generation on Groq LPU hardware with low wall-clock latency',
        'Strong open-weight reasoning and clean unified patch generation',
        'Consistent structured output formatting under strict test-preservation rules',
      ],
      bestFor: 'Head-to-head open-weight reasoning speed and accuracy benchmarks.',
    },
    {
      id: 'groq/openai/gpt-oss-20b',
      label: 'GPT-OSS 20B',
      provider: 'groq',
      parameters: '20B total · ~3.6B active',
      architecture: 'Compact Open-Weight MoE · Groq LPU',
      contextWindow: '128K tokens',
      strengths: [
        'Lightweight parameter footprint delivering near-instant Groq LPU inference',
        'Useful efficiency tier to contrast compact vs. 120B open-weight models',
        'Effective on well-scoped single-module feature additions',
      ],
      bestFor: 'Comparing small vs. large open-weight parameter tiers on the same task.',
    },
    {
      id: 'groq/qwen/qwen3.8-27b',
      label: 'Qwen 3.8 27B (Groq)',
      provider: 'groq',
      parameters: '27B dense parameters',
      architecture: 'Open-Weight Dense Transformer · Groq LPU',
      contextWindow: '128K tokens',
      strengths: [
        'High coding capability per parameter with strong syntax precision',
        'Fast Groq execution combined with Qwen code-centric pretraining',
        'Strong adherence to existing codebase conventions and regression safety',
      ],
      bestFor: 'Fast dense open-weight baseline on Groq infrastructure.',
    },
  ],
  qwen: [
    {
      id: 'adaption/qwen3.5-397b',
      label: 'Qwen 3.5 397B (Default)',
      provider: 'adaption',
      parameters: '397B total · 17B active',
      architecture: 'Large Open-Weight MoE · Adaption AI',
      contextWindow: '131K tokens',
      strengths: [
        'Flagship 397B MoE parameter scale tuned for multi-file software engineering',
        'Strong logical deduction, test-driven reasoning, and structured JSON output',
        'Competitive open-weight accuracy on medium and hard coding benchmarks',
      ],
      bestFor: 'Flagship open-weight coding comparisons against frontier proprietary models.',
    },
    {
      id: 'adaption/qwen-SEA-LION-v5-397b-a17b-plus',
      label: 'Qwen SEA-LION v5 397B (262K Context)',
      provider: 'adaption',
      parameters: '397B total · 17B active',
      architecture: 'Extended-Context Open-Weight MoE · Adaption AI',
      contextWindow: '262K tokens',
      strengths: [
        'Doubled 262K context window retains larger repository trees without truncation',
        'Full 397B MoE coding capacity for cross-file dependency tracking',
        'Ideal when tasks span many source files, schemas, and regression suites',
      ],
      bestFor: 'Larger repositories and multi-module tasks needing extended context.',
    },
  ],
};

export function findModelSpec(modelId: string): ModelSpec | null {
  const normalized = modelId.trim().toLowerCase();
  for (const list of Object.values(MODEL_PRESETS_BY_SLOT)) {
    const match = list.find((item) => item.id.toLowerCase() === normalized);
    if (match) return match;
  }
  return null;
}

interface ModelInfoTooltipProps {
  slotId: 'gemini' | 'gpt_oss' | 'qwen';
  selectedModelId: string;
  slotDisplayName: string;
}

export function ModelInfoTooltip({
  slotId,
  selectedModelId,
  slotDisplayName,
}: ModelInfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const presets = MODEL_PRESETS_BY_SLOT[slotId];
  const activeSpec = findModelSpec(selectedModelId);

  useEffect(() => {
    if (!open && !pinned) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, pinned]);

  const isVisible = open || pinned;

  return (
    <div
      ref={containerRef}
      className="model-tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        className="model-tooltip-trigger"
        aria-label={`Model specs and strengths for ${slotDisplayName}`}
        aria-expanded={isVisible}
        aria-describedby={isVisible ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!pinned && !containerRef.current?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((prev) => {
            const next = !prev;
            setOpen(next);
            return next;
          });
        }}
      >
        <Info size={13} />
        <span>Specs</span>
      </button>

      {isVisible && (
        <div id={tooltipId} role="tooltip" className="model-tooltip-popover">
          {activeSpec ? (
            <>
              <div className="model-tooltip-header">
                <div className="model-tooltip-title">{activeSpec.label}</div>
                <code className="model-tooltip-id">{activeSpec.id}</code>
              </div>

              <div className="model-tooltip-specs">
                <div className="model-tooltip-spec-row">
                  <Cpu size={12} className="model-tooltip-spec-icon" />
                  <span className="model-tooltip-spec-label">Params</span>
                  <span className="model-tooltip-spec-val">{activeSpec.parameters}</span>
                </div>
                <div className="model-tooltip-spec-row">
                  <Layers size={12} className="model-tooltip-spec-icon" />
                  <span className="model-tooltip-spec-label">Context</span>
                  <span className="model-tooltip-spec-val">{activeSpec.contextWindow}</span>
                </div>
              </div>

              <div className="model-tooltip-arch">{activeSpec.architecture}</div>

              <div className="model-tooltip-section-label">
                <Sparkles size={11} />
                <span>Key Strengths</span>
              </div>
              <ul className="model-tooltip-list">
                {activeSpec.strengths.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>

              <div className="model-tooltip-best">
                <strong>Best for:</strong> {activeSpec.bestFor}
              </div>
            </>
          ) : (
            <>
              <div className="model-tooltip-header">
                <div className="model-tooltip-title">Custom Model Identifier</div>
                <code className="model-tooltip-id">{selectedModelId || 'Not specified'}</code>
              </div>
              <p className="model-tooltip-custom-copy">
                Using a custom model ID. Supported prefixes are <code>gemini/*</code>,{' '}
                <code>groq/*</code>, and <code>adaption/*</code>.
              </p>
            </>
          )}

          {presets.length > 1 && (
            <div className="model-tooltip-presets-footer">
              <span className="model-tooltip-presets-heading">Available in this dropdown:</span>
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={`model-tooltip-preset-line${
                    preset.id.toLowerCase() === selectedModelId.trim().toLowerCase()
                      ? ' model-tooltip-preset-line--active'
                      : ''
                  }`}
                >
                  <span>{preset.label.replace(' (Default)', '')}</span>
                  <span>{preset.parameters.split('·')[0].trim()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
