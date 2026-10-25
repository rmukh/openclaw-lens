import { useTranslation } from 'react-i18next';
import { DateNavigator, Dropdown } from './ui';
import { TOKEN_PERIOD_OPTIONS } from '../lib/token-period';
import type { useTokenPeriod } from '../lib/use-token-period';

export function TokenPeriodPicker({ period, ariaLabel, errorId }: {
  period: ReturnType<typeof useTokenPeriod>;
  ariaLabel: string;
  errorId: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      <Dropdown ariaLabel={ariaLabel} value={period.selection} onChange={period.choose}
        options={TOKEN_PERIOD_OPTIONS.map(([value, label]) => ({ value, label: t(label) }))} />
      {period.selection === 'custom' && (
        <div role="group" aria-label={t('sessions.customRange')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="date" aria-label={t('sessions.startDate')} value={period.customStart} max={period.customEnd || undefined}
            required aria-invalid={!!period.range.error} aria-describedby={period.range.error ? errorId : undefined}
            onChange={event => period.setCustomStart(event.target.value)} style={{ padding: '.35rem .55rem' }} />
          <span aria-hidden="true" style={{ color: 'var(--muted)' }}>-</span>
          <input type="date" aria-label={t('sessions.endDate')} value={period.customEnd} min={period.customStart || undefined}
            required aria-invalid={!!period.range.error} aria-describedby={period.range.error ? errorId : undefined}
            onChange={event => period.setCustomEnd(event.target.value)} style={{ padding: '.35rem .55rem' }} />
        </div>
      )}
      {period.selection === 'day' && <DateNavigator mode="hour" value={period.singleDay} onChange={period.setSingleDay} />}
      {period.selection === 'week' && <DateNavigator mode="day" value={period.weekEnd} onChange={period.setWeekEnd} />}
    </div>
  );
}
