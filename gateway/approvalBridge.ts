/**
 * One authenticated WebSocket owns one set of native approval callbacks.
 * An approval response is never a generic RPC: it must match an outstanding
 * server-originated request on this very connection, with an offered decision.
 */
type ApprovalMethod = 'item/commandExecution/requestApproval' |
  'item/fileChange/requestApproval' | 'item/permissions/requestApproval' |
  'mcpServer/elicitation/request' | 'item/tool/requestUserInput';
type Decision = 'accept' | 'acceptForSession' | 'decline' | 'cancel' |
  'grantTurn' | 'grantStrictTurn' | 'grantSession' | 'deny';
const decisions = new Set<Decision>(['accept', 'acceptForSession', 'decline', 'cancel']);
const approvalMethods = new Set<ApprovalMethod>([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
]);
type PendingApproval = {
  method: ApprovalMethod; threadId: string; turnId: string; itemId: string;
  allowed: Set<Decision>;
  requested?: Record<string, unknown>;
  elicitation?: { mode: 'url' | 'form' | 'unsupported'; schema?: Record<string, unknown> };
  questions?: { id: string; options?: string[]; allowOther: boolean }[];
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const isId = (v: unknown): v is number | string =>
  typeof v === 'number'
    ? Number.isSafeInteger(v) && v >= 0
    : typeof v === 'string' && /^[\w.:-]{1,128}$/.test(v);

function validFormContent(schema: Record<string, unknown>, content: unknown): boolean {
  const props = object(schema.properties);
  const values = object(content);
  if (schema.type !== 'object' || !props || !values ||
      Object.keys(props).length > 12 || JSON.stringify(values).length > 32768) return false;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((name) => typeof name !== 'string' || !(name in values))) return false;
  for (const [key, value] of Object.entries(values)) {
    if (!/^[\w.-]{1,80}$/.test(key)) return false;
    const field = object(props[key]);
    if (!field) return false;
    if (Array.isArray(field.enum)) {
      if (!field.enum.includes(value)) return false;
    } else if (field.type === 'string') {
      if (typeof value !== 'string' || value.length > 4096 ||
          (typeof field.minLength === 'number' && value.length < field.minLength) ||
          (typeof field.maxLength === 'number' && value.length > field.maxLength)) return false;
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') return false;
    } else if (field.type === 'integer' || field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          (field.type === 'integer' && !Number.isInteger(value)) ||
          (typeof field.minimum === 'number' && value < field.minimum) ||
          (typeof field.maximum === 'number' && value > field.maximum)) return false;
    } else return false;
  }
  return true;
}

export class ApprovalBridge {
  private readonly pending = new Map<number | string, PendingApproval>();

  observeNativeFrame(frame: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(frame); } catch { return; }
    const data = object(parsed);
    if (!data || typeof data.method !== 'string') return;
    const params = object(data.params);
    if (data.method === 'item/tool/requestUserInput') {
      if (!isId(data.id) || !params ||
          typeof params.threadId !== 'string' || !params.threadId ||
          typeof params.turnId !== 'string' || !params.turnId ||
          typeof params.itemId !== 'string' || !params.itemId ||
          !Array.isArray(params.questions) || params.questions.length < 1 ||
          params.questions.length > 8 || this.pending.size >= 64) return;
      const questions: NonNullable<PendingApproval['questions']> = [];
      for (const raw of params.questions) {
        const q = object(raw);
        if (!q || typeof q.id !== 'string' || !/^[\w.:-]{1,80}$/.test(q.id) ||
            questions.some((v) => v.id === q.id) ||
            typeof q.question !== 'string' || !q.question ||
            (q.options !== undefined && q.options !== null &&
              (!Array.isArray(q.options) || q.options.length > 20))) return;
        const options = Array.isArray(q.options) ? q.options.map((v) => object(v)?.label) : undefined;
        if (options?.some((v) => typeof v !== 'string' || !v || v.length > 150)) return;
        questions.push({ id: q.id, ...(options ? { options: options as string[] } : {}),
          allowOther: q.isOther === true });
      }
      this.pending.set(data.id, { method: data.method,
        threadId: params.threadId, turnId: params.turnId, itemId: params.itemId,
        allowed: new Set(['accept']), questions });
      return;
    }
    if (data.method === 'mcpServer/elicitation/request') {
      if (!isId(data.id) || !params ||
          typeof params.threadId !== 'string' || !params.threadId ||
          typeof params.serverName !== 'string' || !params.serverName ||
          this.pending.size >= 64) return;
      const schema = object(params.requestedSchema);
      const mode = params.mode === 'url' && typeof params.url === 'string' &&
        params.url.length <= 2048 && /^https:\/\/[^\s]+$/i.test(params.url) ? 'url'
        : ['form', 'openai/form', 'openaiForm'].includes(String(params.mode)) &&
          schema?.type === 'object' && object(schema.properties) &&
          Object.keys(object(schema.properties)!).length <= 12 ? 'form' : 'unsupported';
      this.pending.set(data.id, {
        method: data.method, threadId: params.threadId,
        turnId: typeof params.turnId === 'string' ? params.turnId : '', itemId: '',
        allowed: new Set(mode === 'unsupported' ? ['decline', 'cancel'] :
          ['accept', 'decline', 'cancel']),
        elicitation: { mode, ...(schema ? { schema } : {}) },
      });
      return;
    }
    if (approvalMethods.has(data.method as ApprovalMethod)) {
      if (!isId(data.id) || !params ||
          typeof params.threadId !== 'string' || !params.threadId ||
          typeof params.turnId !== 'string' || !params.turnId ||
          typeof params.itemId !== 'string' || !params.itemId ||
          this.pending.size >= 64) return;
      const isPermission = data.method === 'item/permissions/requestApproval';
      const requested = object(params.permissions);
      if (isPermission && (!requested ||
          JSON.stringify(requested).length > 65536 ||
          Object.keys(requested).some((key) => key !== 'network' && key !== 'fileSystem'))) return;
      const offered: Decision[] = isPermission
        ? ['grantTurn', 'grantStrictTurn', 'grantSession', 'deny']
        : Array.isArray(params.availableDecisions)
        ? params.availableDecisions.filter((v): v is Decision =>
            typeof v === 'string' && decisions.has(v as Decision))
        : data.method === 'item/fileChange/requestApproval'
          ? ['accept', 'acceptForSession', 'decline', 'cancel'] as Decision[]
          : ['accept', 'decline', 'cancel'] as Decision[];
      this.pending.set(data.id, {
        method: data.method as ApprovalMethod,
        threadId: params.threadId, turnId: params.turnId, itemId: params.itemId,
        allowed: new Set(offered),
        ...(isPermission && requested ? { requested } : {}),
      });
    } else if (data.method === 'serverRequest/resolved' && isId(params?.requestId)) {
      this.pending.delete(params.requestId);
    } else if (data.method === 'turn/completed' || data.method === 'item/completed') {
      const threadId = params?.threadId;
      const turnId = params?.turnId ?? object(params?.turn)?.id;
      const itemId = params?.itemId ?? object(params?.item)?.id;
      for (const [id, pending] of this.pending) {
        if (pending.threadId === threadId && pending.turnId === turnId &&
            (data.method === 'turn/completed' || pending.itemId === itemId)) {
          this.pending.delete(id);
        }
      }
    }
  }

  /** Distinguish an ordinary RPC request from a forged or valid approval reply. */
  consumeMobileReply(frame: string, binary: boolean):
    'not-reply' | 'allowed' | 'rejected' | { forwarded: string } {
    if (binary || frame.length > 65536) return 'not-reply';
    let parsed: unknown;
    try { parsed = JSON.parse(frame); } catch { return 'not-reply'; }
    const data = object(parsed);
    if (!data || !('result' in data) && !('error' in data)) return 'not-reply';
    if (!isId(data.id) || Object.keys(data).length !== 2 || !('result' in data)) return 'rejected';
    const result = object(data.result);
    const pending = this.pending.get(data.id);
    if (!pending || !result) return 'rejected';
    if (pending.method === 'item/tool/requestUserInput') {
      if (Object.keys(result).length !== 1) return 'rejected';
      const answers = object(result.answers);
      const questions = pending.questions ?? [];
      if (!answers || Object.keys(answers).length !== questions.length) return 'rejected';
      for (const question of questions) {
        const answer = object(answers[question.id]);
        if (!answer || Object.keys(answer).length !== 1 ||
            !Array.isArray(answer.answers) || answer.answers.length !== 1 ||
            typeof answer.answers[0] !== 'string' ||
            answer.answers[0].trim().length === 0 || answer.answers[0].length > 4096 ||
            (question.options && !question.options.includes(answer.answers[0]) &&
              !question.allowOther)) return 'rejected';
      }
      this.pending.delete(data.id);
      return 'allowed';
    }
    if (pending.method === 'mcpServer/elicitation/request') {
      if (typeof result.action !== 'string' ||
          !pending.allowed.has(result.action as Decision)) return 'rejected';
      if (result.action !== 'accept') {
        if (Object.keys(result).length !== 1) return 'rejected';
      } else if (pending.elicitation?.mode === 'url') {
        if (Object.keys(result).length !== 1) return 'rejected';
      } else if (pending.elicitation?.mode !== 'form' ||
          Object.keys(result).length !== 2 ||
          !pending.elicitation.schema ||
          !validFormContent(pending.elicitation.schema, result.content)) return 'rejected';
      this.pending.delete(data.id);
      return 'allowed';
    }
    if (Object.keys(result).length !== 1 || typeof result.decision !== 'string' ||
        !pending.allowed.has(result.decision as Decision)) return 'rejected';
    this.pending.delete(data.id);
    if (pending.method === 'item/permissions/requestApproval') {
      const granted: Record<string, unknown> = {};
      if (result.decision !== 'deny') {
        const requested = pending.requested ?? {};
        for (const key of ['network', 'fileSystem']) {
          if (object(requested[key])) granted[key] = requested[key];
        }
      }
      return { forwarded: JSON.stringify({
        id: data.id, result: {
          permissions: granted,
          scope: result.decision === 'grantSession' ? 'session' : 'turn',
          ...(result.decision === 'grantStrictTurn' ? { strictAutoReview: true } : {}),
        },
      }) };
    }
    return 'allowed';
  }
}
