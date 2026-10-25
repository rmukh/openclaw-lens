import { useEffect, useMemo, useState } from 'react';
import { localDateInput } from './session-date-range';
import { tokenPeriodRange } from './token-period';
import type { TokenPeriodSelection } from './token-period';

export function useTokenPeriod() {
  const [selection, setSelection] = useState<TokenPeriodSelection>('p_7');
  const [singleDay, setSingleDay] = useState(() => new Date(localDateInput() + 'T00:00:00'));
  const [weekEnd, setWeekEnd] = useState(() => new Date(localDateInput() + 'T00:00:00'));
  const [customStart, setCustomStart] = useState(() => localDateInput());
  const [customEnd, setCustomEnd] = useState(() => localDateInput());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const range = useMemo(() => tokenPeriodRange({ selection,
    singleDay: localDateInput(singleDay.getTime()), weekEnd: localDateInput(weekEnd.getTime()), customStart, customEnd,
  }, now), [selection, singleDay, weekEnd, customStart, customEnd, now]);
  const choose = (value: TokenPeriodSelection) => {
    setSelection(value);
    setNow(Date.now());
    const today = new Date(localDateInput() + 'T00:00:00');
    if (value === 'day') setSingleDay(today);
    if (value === 'week') setWeekEnd(today);
  };
  return { selection, choose, singleDay, setSingleDay, weekEnd, setWeekEnd,
    customStart, setCustomStart, customEnd, setCustomEnd, range };
}
