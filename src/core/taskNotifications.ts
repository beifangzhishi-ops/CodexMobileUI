import { AppState, Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { unifiedWebUrl } from './unifiedWeb';

type NativeListener = {
  isEnabled: () => Promise<boolean>;
  start: (endpoint: string) => void;
  setEnabled: (enabled: boolean, endpoint: string) => void;
  setActive: (host: string | null, thread: string | null, foreground: boolean) => void;
};
const listener = Platform.OS === 'android'
  ? NativeModules.CodexNotifications as NativeListener | undefined : undefined;
let currentHost: string | null = null;
let currentThread: string | null = null;
const validHostId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(id) &&
  !['all', 'constructor', 'prototype'].includes(id);

function endpointFor(origin: string | null): string | null {
  const approved = unifiedWebUrl(origin);
  return approved ? approved.replace(/^https:/, 'wss:') + '/api/notifications' : null;
}

export async function notificationEnabled(): Promise<boolean> {
  return listener ? listener.isEnabled() : false;
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  return (await PermissionsAndroid.check(permission)) ||
    (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startTaskNotifications(origin: string | null): Promise<boolean> {
  const endpoint = endpointFor(origin);
  if (!listener || !endpoint || !(await listener.isEnabled())) return false;
  if (!(await ensurePermission())) return false;
  listener.start(endpoint);
  return true;
}

export async function setTaskNotifications(origin: string | null, enabled: boolean): Promise<boolean> {
  const endpoint = endpointFor(origin);
  if (!listener || !endpoint) return false;
  if (enabled && !(await ensurePermission())) return false;
  listener.setEnabled(enabled, endpoint);
  return true;
}

export function setVisibleTask(hostId: string | null, threadId: string | null): void {
  currentHost = hostId === '6v' || hostId === 'noha' ? hostId : null;
  currentThread = typeof threadId === 'string' && /^[a-zA-Z0-9_-]{8,256}$/.test(threadId)
    ? threadId : null;
  listener?.setActive(currentHost, currentThread, AppState.currentState === 'active');
}

export function observeAppVisibility(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    listener?.setActive(currentHost, currentThread, state === 'active');
  });
  return () => subscription.remove();
}

export type TaskLink = { hostId: string } & (
  { threadId: string } | { taskId: string; runId: string }
);
export function parseTaskLink(url: string): TaskLink | null {
  try {
    const parsed = new URL(url);
    const hostId = parsed.searchParams.get('host');
    if (parsed.protocol !== 'codexmobileui:' || !validHostId(hostId)) return null;
    if (parsed.hostname === 'reminder') {
      const taskId = parsed.searchParams.get('task');
      const runId = parsed.searchParams.get('run');
      const id = /^[a-f0-9-]{36}$/;
      return taskId && runId && id.test(taskId) && id.test(runId) ? { hostId, taskId, runId } : null;
    }
    const threadId = parsed.searchParams.get('thread');
    return parsed.hostname === 'thread' && (hostId === '6v' || hostId === 'noha') &&
      threadId && /^[a-zA-Z0-9_-]{8,256}$/.test(threadId)
      ? { hostId, threadId } : null;
  } catch { return null; }
}

export function observeTaskLinks(callback: (link: TaskLink) => void): () => void {
  void Linking.getInitialURL().then((url) => {
    const link = url ? parseTaskLink(url) : null;
    if (link) callback(link);
  }).catch(() => undefined);
  const subscription = Linking.addEventListener('url', (event) => {
    const link = parseTaskLink(event.url);
    if (link) callback(link);
  });
  return () => subscription.remove();
}
