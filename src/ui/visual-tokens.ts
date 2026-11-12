import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import savedTokens from './visual-tokens.json';

export type VisualTokens = typeof savedTokens;
export const visualDefaults: VisualTokens = savedTokens;

// This is an emulator-only development bridge. Android Emulator's 10.0.2.2
// maps to the host's loopback address; no public interface is exposed.
const previewUrl = 'http://10.0.2.2:49173/api/tokens';

const ranges: Record<keyof VisualTokens, [number, number] | 'color'> = {
  headerHeight: [44, 84],
  sidebarWidthPercent: [65, 95],
  sidebarMaxWidth: [280, 500],
  sidebarSlideDurationMs: [100, 500],
  sidebarProjectRowHeight: [32, 72],
  sidebarConversationRowHeight: [30, 70],
  sidebarSectionHeight: [32, 70],
  sidebarTopHeight: [65, 120],
  sidebarBottomHeight: [65, 120],
  newChatHeight: [36, 65],
  newChatIconSize: [14, 34],
  composerMinHeight: [70, 160],
  composerRadius: [10, 40],
  composerToolbarHeight: [34, 66],
  composerBackground: 'color',
  logoMarkWidth: [420, 840],
  logoAdaptiveMarkWidth: [360, 750],
};

export function validateVisualTokens(value: unknown): VisualTokens | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const incoming = value as Record<string, unknown>;
  const next = { ...visualDefaults };
  for (const key of Object.keys(ranges) as (keyof VisualTokens)[]) {
    const v = incoming[key];
    const range = ranges[key];
    if (range === 'color') {
      if (typeof v !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(v)) return null;
      (next as unknown as Record<string, unknown>)[key] = v;
    } else {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1]) return null;
      (next as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return next;
}

export function useVisualTokens(): VisualTokens {
  const [visual, setVisual] = useState<VisualTokens>(visualDefaults);
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'android') return;
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(previewUrl, { signal: controller.signal });
        if (!response.ok) return;
        const candidate = validateVisualTokens(await response.json());
        if (active && candidate) setVisual((previous) =>
          JSON.stringify(previous) === JSON.stringify(candidate) ? previous : candidate);
      } catch {
        // The visual editor is optional; a disconnected developer server must
        // not affect the normal app or its offline demo conversations.
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 750);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, []);
  return visual;
}
