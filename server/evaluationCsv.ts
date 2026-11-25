import type { EvaluationReport, Trial } from './types.ts';

export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function evaluationSummaryCsv(report: EvaluationReport): string {
  const header =
    'evaluation_id,label,model,scheduled,scored,verified_success,mean_partial_score,feature_cases_passed,feature_cases_total,regression_cases_passed,regression_cases_total,feature_pass,regression_pass,build_success,mean_agent_seconds,input_tokens,output_tokens';
  const rows = report.metrics.map((m) =>
    [
      report.id,
      m.label,
      m.model ?? '',
      m.scheduled,
      m.scored,
      m.verified_success.value ?? '',
      m.mean_partial_score ?? '',
      m.feature_cases_passed ?? '',
      m.feature_cases_total ?? '',
      m.regression_cases_passed ?? '',
      m.regression_cases_total ?? '',
      m.feature_pass.value ?? '',
      m.regression_pass.value ?? '',
      m.build_success.value ?? '',
      m.mean_agent_seconds?.toFixed(2) ?? '',
      m.input_tokens_total ?? '',
      m.output_tokens_total ?? '',
    ]
      .map(csvCell)
      .join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

export function evaluationTrialsCsv(report: EvaluationReport): string {
  const header =
    'evaluation_id,role,label,attempt,model,reward,partial_score,feature_passed,feature_total,regression_passed,regression_total,protected_guard_passed,trustworthy,failure';
  const all = [report.oracle, report.baseline_control, ...report.trials].filter(Boolean) as Trial[];
  const rows = all.map((t) =>
    [
      report.id,
      t.role,
      t.label,
      t.attempt,
      t.configuration?.model || t.resolved_models[0] || '',
      t.reward ?? '',
      t.test_breakdown?.partial_score ?? '',
      t.test_breakdown?.feature.passed ?? '',
      t.test_breakdown?.feature.total ?? '',
      t.test_breakdown?.regression.passed ?? '',
      t.test_breakdown?.regression.total ?? '',
      t.test_breakdown ? t.test_breakdown.protected_guard_passed : '',
      t.trustworthy,
      t.failure ?? '',
    ]
      .map(csvCell)
      .join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}
