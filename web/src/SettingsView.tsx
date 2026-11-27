import { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, Save, X } from 'lucide-react';
import type { HostId } from './types';
import type { NativeProject } from './nativeProtocol';
import type { PathHosts } from './pathHosts';
import { desktopBridge } from './desktopBridge';

type Kind = 'globalRules' | 'projectRules' | 'config';
type Snapshot = {
  kind: Kind;
  filename: 'AGENTS.md' | 'AGENTS.override.md' | 'config.toml';
  path: string;
  text: string;
  revision: string;
  exists: boolean;
};
type Props = {
  browserNotifications: { available: boolean; enabled: boolean; error: string; toggle: (enabled: boolean) => Promise<void> };
  pathHosts: PathHosts;
  onSavePathHosts: (hosts: PathHosts) => Promise<void>;
  viewerHost: HostId | null;
  viewerHostAuto: boolean;
  onViewerHost: (host: HostId | null) => void;
  hosts: readonly HostId[];
  initialHost: HostId;
  initialProjectId?: string;
  projects: readonly NativeProject[];
  theme: 'light' | 'dark';
  onTheme: (theme: 'light' | 'dark') => void;
  followUpMode: 'steer' | 'queue';
  onFollowUpMode: (mode: 'steer' | 'queue') => void;
  request: (host: HostId, method: string, params: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
};
function snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_SNAPSHOT');
  const data = value as Partial<Snapshot>;
  if (!['config', 'globalRules', 'projectRules'].includes(data.kind ?? '') ||
      !['AGENTS.md','AGENTS.override.md','config.toml'].includes(data.filename ?? '') ||
      typeof data.path !== 'string' || typeof data.text !== 'string' ||
      typeof data.revision !== 'string' || typeof data.exists !== 'boolean') {
    throw Error('INVALID_SNAPSHOT');
  }
  return data as Snapshot;
}
export function SettingsView({ hosts, initialHost, initialProjectId, projects, theme, onTheme,
  followUpMode, onFollowUpMode, request, onClose,
  pathHosts, onSavePathHosts, viewerHost, viewerHostAuto, onViewerHost, browserNotifications }: Props) {
  const [network, setNetwork] = useState<PathHosts>(() => structuredClone(pathHosts));
  const nativeNotifications = (window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }).ReactNativeWebView;
  const [taskNotifications, setTaskNotifications] = useState(true);
  useEffect(() => {
    if (!nativeNotifications) return;
    const update = (event: Event) => {
      setTaskNotifications((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener('codexmobileui:notifications-state', update);
    nativeNotifications.postMessage('codexmobileui:notifications:query');
    return () => window.removeEventListener('codexmobileui:notifications-state', update);
  }, []);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const networkDirty = JSON.stringify(network) !== JSON.stringify(pathHosts);
  const saveNetwork = async () => {
    if (!networkDirty || networkBusy) return;
    setNetworkBusy(true); setNetworkError('');
    try { await onSavePathHosts(network); }
    catch { setNetworkError('网络位置保存失败，请检查 IP 和共享名称'); }
    finally { setNetworkBusy(false); }
  };
  const [host, setHost] = useState<HostId>(initialHost);
  const [kind, setKind] = useState<Kind>(initialProjectId ? 'projectRules' : 'globalRules');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [source, setSource] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dirty = source !== null && draft !== source.text;
  const selection = useMemo(() => kind === 'projectRules'
    ? { kind, projectId, rootIndex: 0 } : { kind }, [kind, projectId]);
  const fileAllowed = kind !== 'projectRules' || !!projectId &&
    projects.some((project) => project.hostId === host && project.id === projectId);
  const askDiscard = () => (!dirty && !networkDirty) ||
    window.confirm('\u6709\u672a\u4fdd\u5b58\u7684\u8bbe\u7f6e\uff0c\u786e\u5b9a\u653e\u5f03\uff1f');
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (askDiscard()) onClose();
    };
    const back = () => { if (askDiscard()) onClose(); };
    window.addEventListener('keydown', escape);
    window.addEventListener('codexmobileui:back', back);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('codexmobileui:back', back);
    };
  }, [dirty, networkDirty, onClose]);
  const changeTarget = (nextHost: HostId, nextKind: Kind, nextProjectId: string) => {
    if (!askDiscard()) return;
    setHost(nextHost); setKind(nextKind); setProjectId(nextProjectId);
    setSource(null); setDraft(''); setError('');
  };

  const refresh = async (discard: boolean) => {
    if (!fileAllowed || loading || busy) return;
    if (dirty && !discard && !askDiscard()) return;
    setLoading(true); setError('');
    try {
      const value = snapshot(await request(host, 'web/hostFile', {
        method: 'workspace/hostFileRead', params: selection,
      }));
      setSource(value); setDraft(value.text);
    } catch {
      setError('无法读取目标电脑上的文件，请检查连接和权限。');
    } finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    if (!fileAllowed) return;
    setLoading(true); setError('');
    void request(host, 'web/hostFile', {
      method: 'workspace/hostFileRead', params: selection,
    }).then((value) => {
      if (!active) return;
      const next = snapshot(value); setSource(next); setDraft(next.text);
    }).catch(() => { if (active) setError('无法读取电脑文件'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, host, kind, projectId, fileAllowed]);

  const save = async () => {
    if (!source || !dirty || loading || busy) return;
    setBusy(true); setError('');
    const text = draft;
    try {
      const next = snapshot(await request(host, 'web/hostFile', {
        method: 'workspace/hostFileWrite', params: {
          ...selection, text, revision: source.revision, filename: source.filename,
        },
      }));
      setSource(next);
      setDraft((current) => current === text ? next.text : current);
    } catch {
      setError('保存未确认或文件已在电脑上改变；请核对内容后刷新。');
    } finally { setBusy(false); }
  };
  return <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && askDiscard()) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-label="设置" className="shared-settings">
      <header><strong>设置</strong>
        <button aria-label="关闭设置" onClick={() => { if (askDiscard()) onClose(); }}><X size={20}/></button>
      </header>
      <label>主题<select value={theme} onChange={(event) =>
        onTheme(event.target.value as 'dark' | 'light')}>
        <option value="dark">深色</option><option value="light">浅色</option>
      </select></label>
      {browserNotifications.available && <>
        <label>浏览器任务完成通知
          <input type="checkbox" checked={browserNotifications.enabled}
            onChange={(event) => void browserNotifications.toggle(event.target.checked)} />
        </label>
        {browserNotifications.error && <p role="status">{browserNotifications.error}</p>}
      </>}
      {nativeNotifications && <label>后台任务完成通知
        <input type="checkbox" aria-label="后台任务完成通知" checked={taskNotifications}
          onChange={(event) => {
            const enabled = event.target.checked;
            setTaskNotifications(enabled);
            nativeNotifications.postMessage('codexmobileui:notifications:' +
              (enabled ? 'enable' : 'disable'));
          }}/>
      </label>}
      {nativeNotifications && <button type="button" className="shared-settings-log-link"
        onClick={() => nativeNotifications.postMessage('codexmobileui:diagnostics:open')}>
        <FileText size={17}/>查看与导出诊断日志
      </button>}
      <label>后续消息处理<select value={followUpMode} onChange={(event) =>
        onFollowUpMode(event.target.value as 'steer' | 'queue')}>
        <option value="steer">引导当前任务</option><option value="queue">排队到下一轮</option>
      </select></label>
      <hr/>
      <strong className="shared-settings-heading">电脑文件路径映射</strong>
      <p>每台电脑的共享名对应 C 盘。发送绝对路径时会逐台确认文件位置。</p>
      {hosts.map((id) => <div key={id} className="path-host-settings">
        <strong>{id}</strong>
        <label>IP 地址<input aria-label={id + ' IP'} value={network[id]?.ip ?? ''}
          onChange={(event) => setNetwork((old) => ({
            ...old, [id]: { share: old[id]?.share ?? '', ip: event.target.value.trim() },
          }))}/></label>
        <label>共享名<input aria-label={id + ' 共享名'} value={network[id]?.share ?? ''}
          onChange={(event) => setNetwork((old) => ({
            ...old, [id]: { ip: old[id]?.ip ?? '', share: event.target.value.trim() },
          }))}/></label>
      </div>)}
      {!desktopBridge() && <label>当前浏览器所在电脑
        <select value={viewerHost ?? ''} disabled={viewerHostAuto} onChange={(event) =>
          onViewerHost(event.target.value ? event.target.value as HostId : null)}>
          <option value="">未识别（不转换显示路径）</option>
          {hosts.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <small>{viewerHostAuto ? '已通过本机服务自动识别' : '本机服务不可识别时，可手动选择'}</small>
      </label>}
      {networkError && <p role="alert">{networkError}</p>}
      <button type="button" disabled={!networkDirty || networkBusy}
        onClick={() => { void saveNetwork(); }}>
        <Save size={16}/>{networkBusy ? '保存中' : '保存文件网络位置'}
      </button>
      <hr/>
      <strong className="shared-settings-heading">电脑上的规则与配置</strong>
      <label>电脑<select value={host} disabled={loading || busy}
        onChange={(event) => changeTarget(event.target.value as HostId, kind, '')}>
        {hosts.map((id) => <option key={id} value={id}>{id}</option>)}
      </select></label>
      <label>文件<select value={kind} disabled={loading || busy}
        onChange={(event) => changeTarget(host, event.target.value as Kind, projectId)}>
        <option value="globalRules">全局 AGENTS.md</option>
        <option value="config">config.toml</option>
        <option value="projectRules">项目 AGENTS.md</option>
      </select></label>
      {kind === 'projectRules' && <label>项目<select value={projectId} disabled={loading || busy}
        onChange={(event) => changeTarget(host, kind, event.target.value)}>
        <option value="">选择项目</option>
        {projects.filter((project) => project.hostId === host).map((project) =>
          <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}
      <div className="shared-settings-path" title={source?.path ?? ''}>
        {source ? source.path + (source.exists ? '' : '（尚未创建）') : '等待读取电脑文件'}
      </div>
      <textarea aria-label="电脑文件内容" value={draft} disabled={!source || loading || busy}
        onChange={(event) => setDraft(event.target.value)} spellCheck={false} rows={11}/>
      {error && <p role="alert">{error}</p>}
      <footer>
        <span>{loading ? '读取中…' : busy ? '保存中…' : dirty ? '未保存' : source ? '已同步' : '未连接'}</span>
        <button disabled={!source || loading || busy} onClick={() => { void refresh(false); }}>
          <RefreshCw size={16}/>刷新
        </button>
        <button disabled={!source || !dirty || loading || busy} onClick={() => { void save(); }}>
          <Save size={16}/>保存
        </button>
      </footer>
    </section>
  </div>;
}
