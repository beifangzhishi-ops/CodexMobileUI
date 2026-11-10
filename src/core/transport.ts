import type { Host } from './host';
import { websocketUrl } from './host';
import type { CodexNotice, JsonObject } from './protocol';
import { recordOf } from './protocol';
import { logDiagnostic } from '../diagnostics/journal';
import { classifyDiagnosticError } from '../diagnostics/safe';

interface ResponseMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: JsonObject;
  type?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CodexTransport {
  private socket: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private requestId = 0;
  private listeners = new Set<(event: CodexNotice) => void>();
  private ready = false;
  private onLost: (() => void) | null = null;
  private receivedNotices = 0;

  constructor(private host: Host, private token: string) {}

  get connected(): boolean { return this.ready; }

  subscribe(listener: (event: CodexNotice) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setDisconnectListener(listener: () => void): void { this.onLost = listener; }

  async connect(): Promise<void> {
    if (this.socket) this.close();
    const startedAt = Date.now();
    logDiagnostic('transport.connectStarted');
    const ws = new WebSocket(websocketUrl(this.host));
    this.socket = ws;
    let authenticated = false;
    let completed = false;
    const first = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('网关连接超时')), 12_000);
      const fail = (message: string) => {
        clearTimeout(timer);
        if (!completed) { completed = true; reject(new Error(message)); }
      };
      ws.onopen = () => {
        logDiagnostic('transport.socketOpened', { durationMs: Date.now() - startedAt });
        ws.send(JSON.stringify({ type: 'authenticate', accessToken: this.token }));
        logDiagnostic('transport.authSent');
      };
      ws.onmessage = (event) => {
        let data: ResponseMessage;
        try { data = JSON.parse(String(event.data)) as ResponseMessage; }
        catch { return; }
        if (!authenticated) {
          if (data.type === 'ready') {
            logDiagnostic('transport.authReady', { durationMs: Date.now() - startedAt });
            authenticated = true;
            this.ready = true;
            clearTimeout(timer);
            if (!completed) { completed = true; resolve(); }
          } else if (data.type === 'error') fail('网关认证失败或后端不可用');
          return;
        }
        this.dispatch(data);
      };
      ws.onerror = () => {
        logDiagnostic('transport.socketError');
        fail('网关连接失败');
      };
      ws.onclose = (event) => {
        logDiagnostic('transport.socketClosed', { closeCode: event.code });
        this.ready = false;
        fail('网关连接已断开');
        this.rejectAll('网关断开，操作结果待与 Codex 历史核对');
        this.onLost?.();
      };
    });
    try {
      await first;
      logDiagnostic('transport.initializeStarted');
      await this.request('initialize', {
        clientInfo: { name: 'codex_mobile_ui', title: 'CodexMobileUI', version: '0.1.5' },
        capabilities: { experimentalApi: true, requiredHumanApproval: true },
      });
      this.notify('initialized', {});
      logDiagnostic('transport.connectFinished', { durationMs: Date.now() - startedAt });
    } catch (error) {
      logDiagnostic('transport.connectFailed', {
        durationMs: Date.now() - startedAt, ...classifyDiagnosticError(error),
      });
      ws.close();
      throw error;
    }
  }

  private dispatch(data: ResponseMessage): void {
    if (typeof data.id === 'number' && !data.method) {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error.message ?? 'Codex RPC 失败'));
      else pending.resolve(data.result);
      return;
    }
    if (data.method) {
      this.receivedNotices++;
      const monitored = ['turn/started', 'turn/completed', 'item/completed', 'thread/started'];
      if (monitored.includes(data.method) || this.receivedNotices % 100 === 0) {
        logDiagnostic('transport.noticeReceived', {
          method: monitored.includes(data.method) ? data.method.replace('/', '.') : 'batch',
          noticeCount: this.receivedNotices,
        });
      }
      const notice: CodexNotice = {
        method: data.method,
        params: recordOf(data.params),
        ...(typeof data.id === 'number' ? { requestId: data.id } : {}),
      };
      for (const listener of this.listeners) listener(notice);
    }
  }

  /** Reply only to an actual live server-request id, never to a cached approval card. */
  respond(requestId: number, result: JsonObject): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('审批请求对应的连接已断开');
    }
    this.socket.send(JSON.stringify({ id: requestId, result }));
  }

  request(method: string, params: JsonObject = {}, timeoutMs = 25_000): Promise<unknown> {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logDiagnostic('transport.rpcNotConnected');
      return Promise.reject(new Error('电脑当前未连接'));
    }
    const id = ++this.requestId;
    const startedAt = Date.now();
    const safeMethod = ['initialize', 'thread/list', 'thread/read', 'thread/resume', 'thread/start', 'turn/start']
      .includes(method) ? method.replace('/', '.') : 'other';
    logDiagnostic('transport.rpcStarted', { method: safeMethod, timeoutMs, pendingCount: this.pending.size });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        logDiagnostic('transport.rpcTimedOut', { method: safeMethod, durationMs: Date.now() - startedAt });
        reject(new Error(`Codex 请求超时：${method}，执行结果需要核对`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          logDiagnostic('transport.rpcFinished', { method: safeMethod, durationMs: Date.now() - startedAt });
          resolve(value);
        },
        reject: (error) => {
          logDiagnostic('transport.rpcFailed', {
            method: safeMethod, durationMs: Date.now() - startedAt, ...classifyDiagnosticError(error),
          });
          reject(error);
        },
        timeout,
      });
      try { this.socket!.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        logDiagnostic('transport.rpcSendFailed', { method: safeMethod, ...classifyDiagnosticError(error) });
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params: JsonObject): void {
    if (!this.ready || !this.socket) throw new Error('连接已断开');
    this.socket.send(JSON.stringify({ method, params }));
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  close(): void {
    logDiagnostic('transport.closeRequested', { pendingCount: this.pending.size });
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.rejectAll('连接已关闭');
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}
