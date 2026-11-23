import { useEffect, useState } from 'react';

const units = [
  { seconds: 86_400, format: new Intl.NumberFormat('zh-CN', { style: 'unit', unit: 'day', unitDisplay: 'narrow' }) },
  { seconds: 3_600, format: new Intl.NumberFormat('zh-CN', { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }) },
  { seconds: 60, format: new Intl.NumberFormat('zh-CN', { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }) },
  { seconds: 1, format: new Intl.NumberFormat('zh-CN', { style: 'unit', unit: 'second', unitDisplay: 'narrow' }) },
];

export function formatThinkingElapsed(milliseconds: number): string {
  let seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const parts: string[] = [];
  for (const unit of units) {
    const value = Math.floor(seconds / unit.seconds);
    if (value > 0) parts.push(unit.format.format(value));
    seconds %= unit.seconds;
  }
  return parts.join(' ');
}

const now = () => performance.timeOrigin + performance.now();

export function ThinkingIndicator({ startedAt }: { startedAt: number | null | undefined }) {
  const [currentTime, setCurrentTime] = useState(now);
  useEffect(() => {
    if (startedAt == null) return;
    setCurrentTime(now());
    const timer = window.setInterval(() => setCurrentTime(now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt == null ? '' : formatThinkingElapsed(currentTime - startedAt);
  return <div className="thinking-row" aria-live="polite"><span className="activity-spinner"/>
    正在思考{elapsed && ' · 已进行 ' + elapsed}
  </div>;
}
