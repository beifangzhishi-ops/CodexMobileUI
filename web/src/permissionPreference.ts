/** Display-only preference. Never used to change or authorize native permissions. */
const key = 'codexmobileui:custom-permission-v1';
type Saved = Record<string, string>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, child]) => [name, canonical(child)]));
  }
  return value;
}

export async function permissionFingerprint(value: Record<string, unknown>): Promise<string | null> {
  const profile = value.activePermissionProfile as { id?: unknown } | null | undefined;
  const sandbox = value.sandbox as { type?: unknown } | null | undefined;
  if (!sandbox || !['dangerFullAccess', 'readOnly', 'workspaceWrite', 'externalSandbox']
    .includes(String(sandbox.type)) ||
      !['user', 'auto_review', 'guardian_subagent'].includes(String(value.approvalsReviewer)) ||
      value.approvalPolicy == null ||
      !globalThis.crypto?.subtle) return null;
  const json = JSON.stringify(canonical({
    profile: profile?.id ?? null, reviewer: value.approvalsReviewer,
    approvalPolicy: value.approvalPolicy, sandbox: value.sandbox,
  }));
  if (json.length > 65536) return null;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type SavedPermissionSelection = {
  mode: 'default' | 'auto-review' | 'read-only' | 'full-access' | 'custom';
  profile: string | null;
  reviewer: string | null;
  fingerprint?: string | null;
};

export type ResolvedPermission = {
  mode: SavedPermissionSelection['mode'];
  changed: boolean;
};

export function inferPermissionMode(profile: string | null, reviewer: string | null) {
  return profile === ':workspace' ? (reviewer === 'auto_review' ? 'auto-review' : 'default') :
    profile === ':read-only' ? 'read-only' : profile === ':danger-full-access' ? 'full-access' : 'custom';
}

/**
 * A saved fingerprint is required to call a thread explicitly custom after a
 * reload. Legacy threads without one remain at their native-profile inference
 * instead of being retroactively relabeled.
 */
export function resolveResumedPermission(input: {
  profile: string | null;
  reviewer: string | null;
  selected?: SavedPermissionSelection;
  savedFingerprint?: string;
  actualFingerprint?: string | null;
}): ResolvedPermission {
  const inferred = inferPermissionMode(input.profile, input.reviewer);
  if (input.savedFingerprint) {
    const matches = input.actualFingerprint === input.savedFingerprint;
    return {
      mode: matches ? 'custom' : inferred,
      changed: Boolean(input.actualFingerprint && !matches),
    };
  }
  if (input.selected && input.selected.profile === input.profile &&
      input.selected.reviewer === input.reviewer) {
    return { mode: input.selected.mode, changed: false };
  }
  return { mode: inferred, changed: false };
}

function preferences(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([name, value]) =>
      /^(6v|noha):[A-Za-z0-9_-]{1,128}$/.test(name) && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) as Saved;
  } catch { return {}; }
}

export function readCustomPermission(key: string): string | undefined {
  return preferences()[key];
}
export function storeCustomPermission(threadKey: string, fingerprint: string | null) {
  try {
    const all = preferences();
    delete all[threadKey];
    if (fingerprint) all[threadKey] = fingerprint;
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-500))));
  } catch { /* Storage is optional; native state remains authoritative. */ }
}
