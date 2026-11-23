import { isDeepStrictEqual } from 'node:util';

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Fields : null;

/** The App Server—not the Gateway—resolves config.toml and cwd layers.
 * Carry that native result directly into thread/settings/update without
 * reimplementing sandbox, permissions-profile or granular approval semantics.
 */
export function settingsFromNativeDefault(result: unknown): {
  update: Fields;
  expected: { profile: string | null; reviewer: string; approvalPolicy: unknown; sandbox: Fields };
} {
  const source = record(result);
  const profile = record(source?.activePermissionProfile);
  const id = profile?.id;
  const sandbox = record(source?.sandbox);
  const reviewer = source?.approvalsReviewer;
  const policy = source?.approvalPolicy;
  if (!source || !sandbox || typeof sandbox.type !== 'string' ||
      !['dangerFullAccess', 'readOnly', 'workspaceWrite', 'externalSandbox'].includes(sandbox.type) ||
      typeof reviewer !== 'string' ||
      !['user', 'auto_review', 'guardian_subagent'].includes(reviewer) ||
      (typeof policy !== 'string' && !record(policy)) ||
      (id !== null && id !== undefined &&
        (typeof id !== 'string' || !id || id.length > 128)) ||
      JSON.stringify({ sandbox, policy }).length > 65536) {
    throw new Error('NATIVE_DEFAULT_UNAVAILABLE');
  }
  // Named profiles must be selected by ID; native API rejects combining
  // permissions and sandboxPolicy. For legacy config use its exact native
  // sandboxPolicy object, not a guessed workspace/read-only mapping.
  const update: Fields = id
    ? { permissions: id }
    : { sandboxPolicy: sandbox };
  update.approvalPolicy = policy;
  update.approvalsReviewer = reviewer;
  return { update,
    expected: { profile: typeof id === 'string' ? id : null,
      reviewer, approvalPolicy: policy, sandbox } };
}

export function verifyNativePermissionApplied(
  result: unknown, expected: ReturnType<typeof settingsFromNativeDefault>['expected'],
): { profile: string | null; reviewer: string } {
  const response = record(result);
  const profile = record(response?.activePermissionProfile)?.id ?? null;
  if (!response || profile !== expected.profile ||
      response.approvalsReviewer !== expected.reviewer ||
      !isDeepStrictEqual(response.approvalPolicy, expected.approvalPolicy) ||
      !isDeepStrictEqual(response.sandbox, expected.sandbox)) {
    throw new Error('NATIVE_PERMISSION_NOT_CONFIRMED');
  }
  return { profile: expected.profile, reviewer: expected.reviewer };
}
