import { WebSocket } from 'ws';
import type {
  QuotaGuardRuntime, QuotaHostId, QuotaInterrupt,
} from '../shared/quotaGuard.js';
import {
  mergeQuotaGuardTriggers, parseNativeQuotaWindows,
} from '../shared/quotaGuard.js';
import {
  QuotaGuardSettingStore, quotaGuardFileAdmission, type QuotaGuardAdmission,
} from './quotaGuardState.js';

type Json = Record<string, unknown>;
type Pending = {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type GuardOptions = {
  pollMs?: number;
  maxReadAgeMs?: number;
  peerPollMs?: number;
  retryDelaysMs?: readonly number[];
};

const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const nativeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(value);

/**
 * Host-local quota authority for admission and interruption. It owns its own
 * native connection and therefore works with no browser, title worker, or
 * scheduler UI open. It never exposes a new network listener or OS process.
 */
export class QuotaGuardService {
  private readonly store: QuotaGuardSettingStore;
  private readonly pollMs: number;
  private readonly maxReadAgeMs: number;
  private readonly peerPollMs: number;
  private readonly peerHostId: QuotaHostId;
  private readonly retryDelaysMs: readonly number[];
  private socket: WebSocket | null = null;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private peerPollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private nextId = 0;
  private requests = new Map<number, Pending>();
  private initialized = false;
  private refreshing: Promise<void> | null = null;
  private discovering: Promise<void> | null = null;
  private runtime: QuotaGuardRuntime;
  private interruptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activeTurns = new Map<string, { threadId: string; turnId: string }>();
  private interruptsInFlight = new Set<string>();
  private readFailureCount = 0;
  private rateGeneration = 0;
  private refreshAgain = false;
  private guardBlocked = false;

  constructor(private readonly stateDirectory: string, private readonly upstream: string,
    private readonly hostId: QuotaHostId, options: GuardOptions = {}) {
    this.pollMs = options.pollMs ?? 60_000;
    this.maxReadAgeMs = options.maxReadAgeMs ?? Math.max(120_000, this.pollMs * 2 + 15_000);
    this.peerPollMs = options.peerPollMs ?? 1_000;
    this.peerHostId = hostId === '6v' ? 'noha' : '6v';
    this.retryDelaysMs = options.retryDelaysMs ?? [750, 1_500, 3_000];
    this.store = new QuotaGuardSettingStore(stateDirectory);
    const setting = this.store.readSettingSync(hostId);
    this.runtime = this.store.readRuntimeSync(hostId) ?? {
      version: 1, hostId, revision: 0, updatedAt: Date.now(), settingRevision: setting.revision,
      enabled: setting.enabled, nativeStatus: 'connecting', lastReadAt: null,
      lastReadError: null, discovery: 'idle', triggers: [], interrupts: [],
    };
    this.runtime = { ...this.runtime, hostId, nativeStatus: 'connecting',
      updatedAt: Date.now(), discovery: this.runtime.discovery ?? 'idle' };
    this.persist();
  }

  start(): void {
    if (this.closed || this.socket) return;
    this.startPeerMonitor();
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.readRetryTimer) clearTimeout(this.readRetryTimer);
    if (this.peerPollTimer) clearInterval(this.peerPollTimer);
    for (const timer of this.interruptTimers.values()) clearTimeout(timer);
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.readRetryTimer = null;
    this.peerPollTimer = null;
    this.interruptTimers.clear();
    this.activeTurns.clear();
    this.interruptsInFlight.clear();
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('NATIVE_OFFLINE'));
    }
    this.requests.clear();
    this.socket?.close();
    this.socket = null;
  }

  admission(now = Date.now()): QuotaGuardAdmission {
    return quotaGuardFileAdmission(this.store, this.hostId, this.maxReadAgeMs, now);
  }

  status(): QuotaGuardRuntime {
    const setting = this.store.readSettingSync(this.hostId);
    return { ...this.runtime, enabled: setting.enabled,
      settingRevision: setting.revision, updatedAt: this.runtime.updatedAt };
  }

  async observeRateLimitResponse(input: unknown, observedAt = Date.now()): Promise<void> {
    const readings = parseNativeQuotaWindows(input);
    if (readings.length === 0) {
      this.runtime = { ...this.runtime, nativeStatus: 'online', lastReadAt: null,
        lastReadError: 'QUOTA_SNAPSHOT_INVALID_OR_EMPTY', updatedAt: observedAt };
      this.persist();
      return;
    }
    const triggers = mergeQuotaGuardTriggers(this.runtime.triggers, readings, observedAt);
    const wasBlocked = this.runtime.triggers.length > 0;
    const triggersChanged = JSON.stringify(triggers) !== JSON.stringify(this.runtime.triggers);
    this.runtime = {
      ...this.runtime, triggers, nativeStatus: 'online', lastReadAt: observedAt,
      lastReadError: null, updatedAt: observedAt,
      enabled: this.settingEnabled(),
      settingRevision: this.store.readSettingSync(this.hostId).revision,
    };
    this.persist(triggersChanged);
    if (triggers.length > 0) {
      for (const active of this.activeTurns.values()) {
        await this.interruptTurn(active.threadId, active.turnId, 0);
      }
      await this.recoverActiveTurns();
    }
    else if (wasBlocked) await this.recoverActiveTurns();
  }

  private settingEnabled(): boolean {
    try { return this.store.readSettingSync(this.hostId).enabled; }
    catch { return false; }
  }

  private blocked(): boolean {
    if (!this.settingEnabled()) return false;
    if (this.runtime.triggers.length > 0) return true;
    return (this.store.readPeerRuntimeSync(this.peerHostId)?.runtime.triggers.length ?? 0) > 0;
  }

  private persist(advanceRevision = false): void {
    if (advanceRevision) {
      this.runtime = { ...this.runtime, revision: this.runtime.revision + 1 };
    }
    try { this.store.writeRuntimeSync(this.runtime); }
    catch { /* Native protection remains active even if status could not persist. */ }
  }

  private startPeerMonitor(): void {
    if (this.peerPollTimer) return;
    this.checkGuardLatches();
    this.peerPollTimer = setInterval(() => this.checkGuardLatches(), this.peerPollMs);
  }

  private checkGuardLatches(): void {
    if (this.closed) return;
    const low = this.settingEnabled() &&
      (this.runtime.triggers.length > 0 ||
        (this.store.readPeerRuntimeSync(this.peerHostId)?.runtime.triggers.length ?? 0) > 0);
    if (low && !this.guardBlocked) {
      for (const active of this.activeTurns.values()) {
        void this.interruptTurn(active.threadId, active.turnId, 0);
      }
      void this.recoverActiveTurns();
    }
    this.guardBlocked = low;
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.upstream, {
      handshakeTimeout: 10_000, perMessageDeflate: false,
    });
    this.socket = ws;
    this.initialized = false;
    let opened = false;
    ws.on('open', () => {
      opened = true;
      void this.initialize(ws);
    });
    ws.on('message', (bytes, binary) => {
      if (binary) return;
      let frame: Json;
      try { frame = object(JSON.parse(bytes.toString())); } catch { return; }
      if (typeof frame.id === 'number' && typeof frame.method !== 'string') {
        const pending = this.requests.get(frame.id);
        if (!pending) return;
        this.requests.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.error) pending.reject(new Error('NATIVE_RPC_FAILED'));
        else pending.resolve(object(frame.result));
        return;
      }
      if (typeof frame.method === 'string') {
        if (typeof frame.id === 'number' || typeof frame.id === 'string') {
          ws.send(JSON.stringify({ id: frame.id, error: {
            code: -32000, message: 'Quota guard cannot approve native requests',
          } }));
          return;
        }
        void this.handleNotification(frame.method, object(frame.params));
      }
    });
    const reconnect = () => {
      if (this.socket !== ws || this.closed) return;
      this.socket = null;
      this.initialized = false;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
      for (const pending of this.requests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('NATIVE_OFFLINE'));
      }
      this.requests.clear();
      for (const interrupt of this.runtime.interrupts) {
        if (interrupt.state === 'requested' || interrupt.state === 'retrying') {
          this.updateInterrupt(interrupt.threadId, interrupt.turnId, 'failed', 'NATIVE_OFFLINE');
        }
      }
      this.runtime = { ...this.runtime, nativeStatus: 'offline',
        lastReadError: 'NATIVE_OFFLINE', updatedAt: Date.now() };
      this.persist();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      const delay = Math.min(30_000, 750 * 2 ** Math.min(this.reconnectAttempt++, 5));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };
    ws.once('close', reconnect);
    ws.once('error', () => {
      if (opened) ws.close();
      else reconnect();
    });
  }

  private async initialize(ws: WebSocket): Promise<void> {
    try {
      await this.request('initialize', {
        clientInfo: { name: 'codex_mobile_quota_guard',
          title: 'CodexMobileUI Quota Guard', version: '0.1.0' },
        capabilities: { experimentalApi: true, requiredHumanApproval: false },
      });
      ws.send(JSON.stringify({ method: 'initialized', params: {} }));
      if (this.socket !== ws || this.closed) return;
      this.initialized = true;
      this.reconnectAttempt = 0;
      this.runtime = { ...this.runtime, nativeStatus: 'online',
        lastReadError: null, updatedAt: Date.now() };
      this.persist();
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        if (this.initialized) void this.refreshRateLimits();
      }, this.pollMs);
      await this.refreshRateLimits();
      await this.recoverActiveTurns();
    } catch {
      ws.close();
    }
  }

  private request(method: string, params: Json, timeoutMs = 20_000): Promise<Json> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('NATIVE_OFFLINE'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('NATIVE_TIMEOUT'));
      }, timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        const pending = this.requests.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(id);
        reject(new Error('NATIVE_SEND_FAILED'));
      });
    });
  }

  private async refreshRateLimits(): Promise<void> {
    if (this.closed) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const generation = this.rateGeneration;
    this.refreshing = (async () => {
      try {
        const result = await this.request('account/rateLimits/read', {}, 15_000);
        if (generation !== this.rateGeneration) {
          this.refreshAgain = true;
          return;
        }
        this.readFailureCount = 0;
        if (this.readRetryTimer) clearTimeout(this.readRetryTimer);
        this.readRetryTimer = null;
        await this.observeRateLimitResponse(result);
      } catch {
        this.runtime = { ...this.runtime, nativeStatus: 'offline',
          lastReadError: 'QUOTA_READ_UNAVAILABLE', updatedAt: Date.now() };
        this.persist();
        if (!this.closed && this.readFailureCount < 3) {
          const delay = 1_000 * 2 ** this.readFailureCount++;
          if (this.readRetryTimer) clearTimeout(this.readRetryTimer);
          this.readRetryTimer = setTimeout(() => {
            this.readRetryTimer = null;
            void this.refreshRateLimits();
          }, delay);
        }
      }
    })().finally(() => {
      this.refreshing = null;
      if (this.refreshAgain && !this.closed) {
        this.refreshAgain = false;
        setTimeout(() => { void this.refreshRateLimits(); }, 0);
      }
    });
    return this.refreshing;
  }

  private async handleNotification(method: string, params: Json): Promise<void> {
    if (!this.initialized) return;
    if (method === 'account/rateLimits/updated') {
      this.rateGeneration++;
      const snapshot = object(params.rateLimits);
      if (Object.keys(snapshot).length) {
        await this.observeRateLimitResponse({ rateLimits: snapshot });
      }
      await this.refreshRateLimits();
      return;
    }
    if (method === 'turn/started') {
      const threadId = params.threadId;
      const turnId = object(params.turn).id;
      if (nativeId(threadId) && nativeId(turnId)) {
        this.activeTurns.set(threadId + ':' + turnId, { threadId, turnId });
      }
      if (this.blocked() && nativeId(threadId) && nativeId(turnId)) {
        await this.interruptTurn(threadId, turnId, 0);
      }
      return;
    }
    if (method === 'turn/completed') {
      const threadId = params.threadId;
      const turnId = object(params.turn).id;
      if (nativeId(threadId) && nativeId(turnId)) {
        this.activeTurns.delete(threadId + ':' + turnId);
        const prior = this.runtime.interrupts.find((item) => item.threadId === threadId &&
          item.turnId === turnId && (item.state === 'requested' || item.state === 'retrying'));
        if (prior) this.updateInterrupt(threadId, turnId, 'confirmed', null);
        this.runtime = { ...this.runtime,
          interrupts: this.runtime.interrupts.filter((item) =>
            item.threadId !== threadId || item.turnId !== turnId ||
            item.state === 'confirmed' || item.state === 'failed') };
        this.persist();
      }
      return;
    }
    if ((method === 'thread/status/changed' && object(params.status).type === 'active') ||
        method === 'thread/queue/changed') {
      const threadId = params.threadId;
      if (nativeId(threadId) && this.blocked()) await this.discoverThread(threadId);
    }
  }

  private rememberTurn(threadId: string, turnId: string): void {
    const existing = this.runtime.interrupts.find((item) => item.threadId === threadId &&
      item.turnId === turnId);
    if (existing?.state === 'confirmed' || existing?.state === 'failed') return;
    if (!existing) {
      this.runtime = { ...this.runtime, interrupts: [...this.runtime.interrupts,
        { threadId, turnId, state: 'requested', attempts: 0, requestedAt: Date.now(),
          confirmedAt: null, reason: null }], updatedAt: Date.now() };
      this.persist();
    }
  }

  private updateInterrupt(threadId: string, turnId: string,
    state: QuotaInterrupt['state'], reason: string | null, attempts?: number): void {
    let found = false;
    const interrupts = this.runtime.interrupts.map((item) => {
      if (item.threadId !== threadId || item.turnId !== turnId) return item;
      found = true;
      return { ...item, state, reason,
        attempts: attempts ?? item.attempts,
        confirmedAt: state === 'confirmed' ? Date.now() : item.confirmedAt };
    });
    if (!found) interrupts.push({ threadId, turnId, state, reason,
      attempts: attempts ?? 0, requestedAt: Date.now(),
      confirmedAt: state === 'confirmed' ? Date.now() : null });
    this.runtime = { ...this.runtime, interrupts, updatedAt: Date.now() };
    this.persist();
  }

  private async interruptTurn(threadId: string, turnId: string, attempt: number): Promise<void> {
    if (!this.blocked()) return;
    const key = threadId + ':' + turnId;
    const current = this.runtime.interrupts.find((item) =>
      item.threadId === threadId && item.turnId === turnId);
    if (current?.state === 'confirmed' || this.interruptsInFlight.has(key)) return;
    if (current?.attempts !== undefined && current.attempts >= this.retryDelaysMs.length) return;
    if (current?.state === 'retrying' && this.interruptTimers.has(key)) return;
    if (attempt === 0) this.rememberTurn(threadId, turnId);
    this.interruptsInFlight.add(key);
    const priorTimer = this.interruptTimers.get(key);
    if (priorTimer) clearTimeout(priorTimer);
    try {
      await this.request('turn/interrupt', { threadId, turnId }, 15_000);
      const latest = this.runtime.interrupts.find((item) =>
        item.threadId === threadId && item.turnId === turnId);
      if (latest?.state === 'confirmed') return;
      if (attempt < this.retryDelaysMs.length - 1) {
        this.updateInterrupt(threadId, turnId, 'retrying', 'WAITING_FOR_TERMINAL_CONFIRMATION',
          attempt + 1);
        const timer = setTimeout(() => {
          this.interruptTimers.delete(key);
          const current = this.runtime.interrupts.find((item) => item.threadId === threadId &&
            item.turnId === turnId);
          if (current?.state === 'retrying' && this.blocked()) {
            void this.interruptTurn(threadId, turnId, attempt + 1);
          }
        }, this.retryDelaysMs[attempt]);
        this.interruptTimers.set(key, timer);
      } else {
        this.updateInterrupt(threadId, turnId, 'requested', 'TERMINAL_CONFIRMATION_PENDING',
          attempt + 1);
      }
    } catch (error) {
      const reason = error instanceof Error && error.message === 'NATIVE_TIMEOUT'
        ? 'INTERRUPT_TIMEOUT' : 'NATIVE_OFFLINE';
      if (attempt + 1 < this.retryDelaysMs.length) {
        this.updateInterrupt(threadId, turnId, 'retrying', reason, attempt + 1);
        const timer = setTimeout(() => {
          this.interruptTimers.delete(key);
          void this.interruptTurn(threadId, turnId, attempt + 1);
        }, this.retryDelaysMs[attempt]);
        this.interruptTimers.set(key, timer);
      } else {
        this.updateInterrupt(threadId, turnId, 'failed', reason, attempt + 1);
      }
    } finally { this.interruptsInFlight.delete(key); }
  }

  private async recoverActiveTurns(): Promise<void> {
    if (!this.blocked() || this.discovering) return this.discovering ?? undefined;
    this.discovering = (async () => {
      let incomplete = false;
      try {
        const ids: string[] = [];
        const cursors = new Set<string>();
        let cursor: string | null = null;
        for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
          const loaded = await this.request('thread/loaded/list', {
            limit: 100, ...(cursor ? { cursor } : {}),
          });
          if (Array.isArray(loaded.data)) ids.push(...loaded.data.filter(nativeId));
          const next = loaded.nextCursor;
          if (typeof next !== 'string' || !next) {
            incomplete = false;
            break;
          }
          if (cursors.has(next)) throw new Error('THREAD_LOADED_CURSOR_INVALID');
          cursors.add(next);
          cursor = next;
          incomplete = pageIndex === 99;
        }
        for (const threadId of ids) {
          if (!this.blocked()) break;
          await this.discoverThread(threadId);
        }
      } catch {
        incomplete = true;
      } finally {
        this.runtime = { ...this.runtime,
          discovery: incomplete ? 'incomplete' : 'complete', updatedAt: Date.now() };
        this.persist();
      }
    })().finally(() => { this.discovering = null; });
    return this.discovering;
  }

  private async discoverThread(threadId: string): Promise<void> {
    try {
      const page = await this.request('thread/turns/list', {
        threadId, limit: 2, sortDirection: 'desc', itemsView: 'summary',
      });
      const active = Array.isArray(page.data)
        ? page.data.map(object).find((turn) => turn.status === 'inProgress') : undefined;
      const turnId = active?.id;
      if (nativeId(turnId)) await this.interruptTurn(threadId, turnId, 0);
    } catch { /* A later status, queue, poll, or reconnect retries discovery. */ }
  }
}
