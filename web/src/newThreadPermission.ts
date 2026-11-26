import {
  permissionFingerprint, type SavedPermissionSelection,
} from './permissionPreference.ts';

function selection(
  source: Record<string, unknown>,
  fingerprint: string,
): SavedPermissionSelection & { fingerprint: string } {
  const profile = source.activePermissionProfile as { id?: unknown } | null | undefined;
  return {
    mode: 'custom',
    profile: typeof profile?.id === 'string' ? profile.id : null,
    reviewer: typeof source.approvalsReviewer === 'string' ? source.approvalsReviewer : null,
    fingerprint,
  };
}

/**
 * `thread/start` already returns the exact effective native policy. Persist it
 * before the caller selects the new thread. A resume is only a background
 * fallback for older servers or incomplete responses and can never delay or
 * invalidate an acknowledged thread.
 */
export async function rememberNewThreadCustomPermission(input: {
  threadId: string;
  startResponse: Record<string, unknown>;
  readResume: (threadId: string) => Promise<Record<string, unknown>>;
  isCurrent?: () => boolean;
  remember: (value: SavedPermissionSelection & { fingerprint: string }) => void;
}): Promise<'direct' | 'fallback'> {
  const direct = await permissionFingerprint(input.startResponse).catch(() => null);
  if (direct) {
    if (input.isCurrent?.() !== false) {
      try { input.remember(selection(input.startResponse, direct)); }
      catch { /* Permission display state must not block the acknowledged turn. */ }
    }
    return 'direct';
  }
  void Promise.resolve().then(() => input.readResume(input.threadId))
    .then(async (resumed) => {
      const fingerprint = await permissionFingerprint(resumed).catch(() => null);
      if (!fingerprint || input.isCurrent?.() === false) return;
      try { input.remember(selection(resumed, fingerprint)); }
      catch { /* Best-effort fallback only. */ }
    })
    .catch(() => undefined);
  return 'fallback';
}
