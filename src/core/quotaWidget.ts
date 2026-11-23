import { NativeModules, Platform } from 'react-native';

type NativeQuotaWidget = {
  updateQuota: (host: string, fiveHour: number | null, weekly: number | null, updatedAt: number) => void;
};

/** The WebView can only request display of bounded quota data for known hosts. */
export function updateQuotaWidget(json: string): void {
  if (Platform.OS !== 'android' || json.length > 512) return;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const data = value as Record<string, unknown>;
    if (data.host !== '6v' && data.host !== 'noha') return;
    const percent = (input: unknown): number | null | undefined => {
      if (input === null) return null;
      if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 100) return undefined;
      return Math.round(input);
    };
    const fiveHour = percent(data.fiveHour), weekly = percent(data.weekly);
    if (fiveHour === undefined || weekly === undefined) return;
    const updatedAt = data.updatedAt;
    if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return;
    (NativeModules.QuotaWidget as NativeQuotaWidget | undefined)?.updateQuota(data.host, fiveHour, weekly, updatedAt);
  } catch { /* Invalid/unavailable native widget is never allowed to disrupt chat. */ }
}
