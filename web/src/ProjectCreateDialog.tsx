import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Folder, X } from 'lucide-react';
import { localMessageId } from './browserHelpers';
import type { HostId } from './types';

type Listing = {
  locator: string | null;
  path: string | null;
  directories: { locator: string; name: string; path: string }[];
};

const MAX_PROJECT_NAME_LENGTH = 80;

export function projectDirectoryBasename(path: string | null): string {
  if (!path) return '';
  const normalized = path.replace(/\//g, '\\');
  const trimmed = normalized.replace(/\\+$/, '');
  if (!trimmed || /^[a-zA-Z]:$/.test(trimmed)) return '';
  return trimmed.slice(trimmed.lastIndexOf('\\') + 1);
}

function projectNameLength(value: string): number {
  return Array.from(value.trim()).length;
}

export function validProjectName(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && projectNameLength(value) <= MAX_PROJECT_NAME_LENGTH &&
    !/[\x00-\x1f]/.test(trimmed);
}

export function displayedProjectName(defaultName: string, override: string | null): string {
  return override ?? defaultName;
}

function parseListing(value: unknown): Listing {
  if (!value || typeof value !== 'object') throw Error('INVALID_DIRECTORY_LIST');
  const data = value as Partial<Listing>;
  if (!Array.isArray(data.directories) || data.directories.some((entry) =>
    !entry || typeof entry.locator !== 'string' ||
    typeof entry.path !== 'string' || typeof entry.name !== 'string')) {
    throw Error('INVALID_DIRECTORY_LIST');
  }
  return {
    locator: typeof data.locator === 'string' ? data.locator : null,
    path: typeof data.path === 'string' ? data.path : null,
    directories: data.directories,
  };
}

type Props = {
  hosts: readonly HostId[];
  initialHost: HostId;
  request: (host: HostId, method: string, params: Record<string, unknown>) => Promise<unknown>;
  refresh: (host: HostId) => Promise<void>;
  onClose: () => void;
};

/** Same host-owned directory selector for browser, Android and desktop. */
export function ProjectCreateDialog({ hosts, initialHost, request, refresh, onClose }: Props) {
  const [host, setHost] = useState<HostId>(initialHost);
  const [listing, setListing] = useState<Listing | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const idem = useRef('');
  const defaultName = projectDirectoryBasename(listing?.path ?? null);
  const name = displayedProjectName(defaultName, nameOverride);
  const trimmedName = name.trim();
  const nameTooLong = projectNameLength(name) > MAX_PROJECT_NAME_LENGTH;
  const nameHasControlCharacters = /[\x00-\x1f]/.test(trimmedName);
  const validName = validProjectName(name);

  function load(hostId: HostId, locator: string | null) {
    const current = ++epoch.current;
    setListing(null);
    setError('');
    setLoading(true);
    void request(hostId, 'web/projectDirectories', locator ? { locator } : {})
      .then((value) => {
        if (current !== epoch.current) return;
        const next = parseListing(value);
        setListing(next);
      })
      .catch(() => { if (current === epoch.current) setError('无法读取电脑目录，请检查连接'); })
      .finally(() => { if (current === epoch.current) setLoading(false); });
  }
  useEffect(() => {
    load(host, null);
    return () => { epoch.current++; };
  }, [host]);

  const restoreAutomaticIfEmpty = () => {
    setNameOverride((current) => current === '' ? null : current);
  };
  const navigate = (locator: string | null) => {
    idem.current = '';
    restoreAutomaticIfEmpty();
    load(host, locator);
  };
  const goUp = () => {
    const parent = listing?.locator?.split('/').slice(0, -1).join('/') || null;
    navigate(parent);
  };
  const create = async () => {
    if (creating || !listing?.locator || !validName) return;
    setCreating(true);
    setError('');
    if (!idem.current) idem.current = String(Date.now()) + '-' + localMessageId();
    try {
      await request(host, 'web/projectCreate', {
        name: trimmedName, locator: listing.locator, idempotencyKey: idem.current,
      });
      onClose();
      // The native project mutation was acknowledged; a subsequent list read
      // failure must not turn this into a second create attempt.
      void refresh(host).catch(() => undefined);
    } catch {
      setError('创建结果未确认。请刷新项目列表核对后再重试；重试使用相同请求编号。');
    } finally {
      setCreating(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !creating) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-label="创建项目"
      className="project-create-dialog">
      <header className="project-create-header">
        <strong>创建项目</strong>
        <button aria-label="关闭" disabled={creating} onClick={onClose}><X size={19}/></button>
      </header>
      <label className="project-field">电脑
        <select value={host} disabled={creating} onChange={(event) => {
          restoreAutomaticIfEmpty();
          setHost(event.target.value as HostId); idem.current = '';
        }}>
          {hosts.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      <label className="project-field">项目名称
        <input value={name} disabled={creating} placeholder="项目名称"
          aria-invalid={nameTooLong || nameHasControlCharacters}
          onChange={(event) => { idem.current = ''; setNameOverride(event.target.value); }}
          onBlur={restoreAutomaticIfEmpty}/>
      </label>
      <div className="project-directory-header">
        <strong>选择电脑上的目录</strong>
        <button disabled={loading || !listing?.locator || creating}
          onClick={goUp}><ChevronLeft size={17}/>上一级</button>
      </div>
      <div className="project-directory-current" title={listing?.path ?? ''}>
        {listing?.path ?? '允许的根目录'}
      </div>
      <div className="project-directory-list" role="list">
        {loading ? <p>正在读取目录…</p> :
          listing?.directories.length ? listing.directories.map((entry) =>
            <button role="listitem" key={entry.locator} disabled={creating}
              title={entry.path} onClick={() => navigate(entry.locator)}>
              <Folder size={17}/><span>{entry.name}</span>
            </button>) : <p>{listing ? '当前目录没有子目录' : '暂无目录'}</p>}
      </div>
      {(nameTooLong || nameHasControlCharacters) &&
        <p role="alert" className="project-create-error">
          {nameTooLong ? '项目名称不能超过 80 个字符' : '项目名称包含无效字符'}
        </p>}
      {error && <p role="alert" className="project-create-error">{error}</p>}
      <footer className="project-create-actions">
        <button disabled={creating} onClick={onClose}>取消</button>
        <button disabled={creating || loading || !validName || !listing?.locator}
          onClick={() => { void create(); }}><Check size={17}/>
          {creating ? '创建中…' : '在当前目录创建项目'}</button>
      </footer>
    </section>
  </div>;
}
