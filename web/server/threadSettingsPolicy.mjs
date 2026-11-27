const reasoningEfforts = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function validThreadSettingsUpdate(params, validators) {
  const { subset, validId, validModelIdentifier, validPermissions } = validators;
  if (!validId(params.threadId)) return false;
  if (params.model !== undefined || params.effort !== undefined) {
    return subset(params, ['threadId', 'model', 'effort']) &&
      validModelIdentifier(params.model) &&
      (params.effort === undefined || reasoningEfforts.has(params.effort));
  }
  return subset(params, ['threadId', 'permissions', 'approvalsReviewer']) &&
    typeof params.permissions === 'string' &&
    validPermissions({
      permissions: params.permissions,
      approvalsReviewer: params.approvalsReviewer,
    });
}

export async function updateThreadSettings(params, { verifyModelChoice, internalRequest }) {
  if (params.model !== undefined) {
    await verifyModelChoice(params.model, params.effort);
  } else {
    const profiles = await internalRequest('permissionProfile/list', {});
    if (!Array.isArray(profiles?.data) || !profiles.data.some((profile) =>
      profile?.id === params.permissions && profile.allowed === true)) {
      throw Error('PERMISSION_NOT_ALLOWED');
    }
  }
  return internalRequest('thread/settings/update', params);
}

export async function updatePermissionFromNativeConfig(threadId, {
  internalRequest, settingsFromNativeDefault, verifyNativePermissionApplied,
}) {
  const snapshot = await internalRequest('thread/read', { threadId, includeTurns: true });
  const thread = snapshot?.thread;
  if (thread?.id !== threadId || typeof thread.cwd !== 'string' || !thread.cwd) {
    throw Error('THREAD_NOT_FOUND');
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  if (['inProgress', 'running', 'in_progress'].includes(String(turns.at(-1)?.status))) {
    throw Error('THREAD_BUSY');
  }
  const nativeDefaults = await internalRequest('thread/start', {
    cwd: thread.cwd, ephemeral: true,
  });
  const resolved = settingsFromNativeDefault(nativeDefaults);
  await internalRequest('thread/settings/update', { threadId, ...resolved.update });
  return verifyNativePermissionApplied(
    await internalRequest('thread/resume', { threadId }), resolved.expected);
}
