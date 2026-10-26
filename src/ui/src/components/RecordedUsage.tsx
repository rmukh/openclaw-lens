import { useTranslation } from 'react-i18next';
import { Card, EmptyState, InfoTooltip } from './ui';
import { TABLE_STYLE, TH_STYLE, TD_STYLE, MONO_STYLE, fmtPct } from '../hooks';

export interface ToolCount { toolName: string; toolCalls: number }

export function RecordedCount({ value }: { value: number }) {
  const { i18n } = useTranslation();
  return <>{value.toLocaleString(i18n.resolvedLanguage || 'en')}</>;
}

export function RecordedUsageStats({ llmResponses, toolCalls, explain = false }: {
  llmResponses: number; toolCalls: number; explain?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div data-llm-responses={llmResponses} data-tool-calls={toolCalls}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-4)', fontSize: 13, color: 'var(--muted)' }}>
      <span>{t('tokenUsage.llmResponses')}: <strong style={{ color: 'var(--text)' }}><RecordedCount value={llmResponses} /></strong></span>
      <span>{t('tokenUsage.toolCalls')}: <strong style={{ color: 'var(--text)' }}><RecordedCount value={toolCalls} /></strong></span>
      {explain && <InfoTooltip label={t('tokenUsage.recordedCounts')} width={340}>{t('tokenUsage.recordedCountsHelp')}</InfoTooltip>}
    </div>
  );
}

export function ToolUsageTable({ tools }: { tools: ToolCount[] }) {
  const { t } = useTranslation();
  const total = tools.reduce((sum, tool) => sum + tool.toolCalls, 0);
  return tools.length === 0 ? <EmptyState>{t('tokenUsage.noToolCalls')}</EmptyState> : (
    <Card style={{ padding: 0, overflow: 'auto', maxHeight: 320, minWidth: 0 }}>
      <table aria-label={t('tokenUsage.byTool')} style={{ ...TABLE_STYLE, minWidth: 360 }}>
        <thead><tr>
          <th style={TH_STYLE}>{t('tokenUsage.tool')}</th>
          <th style={{ ...TH_STYLE, textAlign: 'right' }}>{t('tokenUsage.toolCalls')}</th>
          <th style={{ ...TH_STYLE, textAlign: 'right' }}>{t('tokenUsage.share')}</th>
        </tr></thead>
        <tbody>{tools.map(tool => (
          <tr key={tool.toolName} data-tool-name={tool.toolName} data-tool-calls={tool.toolCalls}>
            <td style={{ ...TD_STYLE, ...MONO_STYLE, overflowWrap: 'anywhere' }}>{tool.toolName}</td>
            <td style={{ ...TD_STYLE, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><RecordedCount value={tool.toolCalls} /></td>
            <td style={{ ...TD_STYLE, textAlign: 'right' }}>{fmtPct(total > 0 ? tool.toolCalls / total : 0, 1)}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}
