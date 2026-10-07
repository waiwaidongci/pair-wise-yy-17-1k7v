/** 演示日期固定在 2026-10-08，表单只让教练选“时:分”，降低录入成本 */
const BASE_YEAR = 2026;
const BASE_MONTH = 9; // 10 月（0-based）
const BASE_DAY = 8;

export function toInputValue(epoch: number): string {
  const date = new Date(epoch);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fromInputValue(value: string): number {
  const [hour = '9', minute = '0'] = value.split(':');
  return new Date(BASE_YEAR, BASE_MONTH, BASE_DAY, Number(hour), Number(minute)).getTime();
}

export function formatRange(start: number, end: number): string {
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${fmt(start)}–${fmt(end)}`;
}

export function formatFull(t: number): string {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
