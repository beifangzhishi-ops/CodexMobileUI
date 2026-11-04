import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PUBLIC_CLIENT_ID = 'codexmobileui-android';
const ACCESS_MS = 15 * 60_000;
const REFRESH_MS = 30 * 24 * 60 * 60_000;
const AUTHORIZATION_CODE_MS = 10 * 60_000;

export interface AuthorizationRequest {
  clientId: typeof PUBLIC_CLIENT_ID;
  redirectUri: string;
  challenge: string;
  state: string;
}

interface Code {
  challenge: string;
  redirectUri: string;
  expires: number;
}

interface StoredToken {
  family: string;
  expires: number;
}

interface StoredState {
  access: Record<string, StoredToken>;
  refresh: Record<string, StoredToken>;
}

export interface Tokens {
  token_type: 'Bearer';
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function random(): string {
  return randomBytes(32).toString('base64url');
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export class AuthorizationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/**
 * Only two hosts and one user's public Android client are intended.
 * No public signup, shared static bearer secrets, or third-party IdP.
 */
export class OAuthStore {
  private codes: Record<string, Code>;
  private readonly codeFile: string;
  private state: StoredState;

  constructor(
    private readonly approvalSecret: string,
    private readonly redirectUri: string,
    private readonly stateFile: string,
    private readonly now: () => number = Date.now,
  ) {
    if (approvalSecret.length < 24) throw new Error('MOBILE_APPROVAL_SECRET 至少 24 个字符');
    if (!redirectUri.startsWith('codexmobileui://')) {
      throw new Error('只允许预先配置的 CodexMobileUI OAuth 回调 URI');
    }
    this.state = existsSync(stateFile)
      ? JSON.parse(readFileSync(stateFile, 'utf8')) as StoredState
      : { access: {}, refresh: {} };
    this.codeFile = stateFile + '.codes';
    this.codes = existsSync(this.codeFile)
      ? JSON.parse(readFileSync(this.codeFile, 'utf8')) as Record<string, Code>
      : {};
  }

  /** CCM-style consent: validate the complete request on both GET and POST.
   * No transient server-side intent or short approval-page timeout. */
  validateRequest(params: URLSearchParams): AuthorizationRequest {
    const challenge = params.get('code_challenge') ?? '';
    const state = params.get('state') ?? '';
    if (params.get('client_id') !== PUBLIC_CLIENT_ID ||
        params.get('response_type') !== 'code' ||
        params.get('redirect_uri') !== this.redirectUri ||
        params.get('code_challenge_method') !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        state.length < 8 || state.length > 512) {
      throw new AuthorizationError('invalid_request');
    }
    return {
      clientId: PUBLIC_CLIENT_ID,
      challenge,
      state,
      redirectUri: this.redirectUri,
    };
  }

  /** Wrong consent does not consume the request or issue an authorization code. */
  approve(request: AuthorizationRequest, suppliedSecret: string): string {
    const a = Buffer.from(hash(suppliedSecret), 'hex');
    const b = Buffer.from(hash(this.approvalSecret), 'hex');
    if (!timingSafeEqual(a, b)) throw new AuthorizationError('access_denied');
    const code = random();
    this.codes[hash(code)] = {
      challenge: request.challenge,
      redirectUri: request.redirectUri,
      expires: this.now() + AUTHORIZATION_CODE_MS,
    };
    this.cleanup();
    this.persistCodes();
    const url = new URL(request.redirectUri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', request.state);
    return url.toString();
  }

  exchange(code: string, verifier: string, redirectUri: string): Tokens {
    const id = hash(code);
    const entry = this.codes[id];
    const expected = createHash('sha256').update(verifier).digest('base64url');
    if (!entry || entry.expires < this.now() ||
        redirectUri !== entry.redirectUri ||
        !/^[a-zA-Z0-9._~-]{43,128}$/.test(verifier) ||
        entry.challenge !== expected) {
      throw new AuthorizationError('invalid_grant');
    }
    // CCM pattern: only a correctly verified code becomes consumed.
    delete this.codes[id];
    this.persistCodes();
    return this.mint(random());
  }

  refresh(token: string): Tokens {
    const id = hash(token);
    const item = this.state.refresh[id];
    if (!item || item.expires < this.now()) {
      delete this.state.refresh[id];
      throw new AuthorizationError('invalid_grant');
    }
    delete this.state.refresh[id];
    const next = this.mint(item.family);
    return next;
  }

  verify(token: string): boolean {
    if (!token || token.length > 256) return false;
    const item = this.state.access[hash(token)];
    return Boolean(item && item.expires > this.now());
  }

  revoke(token: string): void {
    const id = hash(token);
    const record = this.state.refresh[id] ?? this.state.access[id];
    if (!record) return;
    for (const key of Object.keys(this.state.access)) {
      if (this.state.access[key].family === record.family) delete this.state.access[key];
    }
    for (const key of Object.keys(this.state.refresh)) {
      if (this.state.refresh[key].family === record.family) delete this.state.refresh[key];
    }
    this.persist();
  }

  private mint(family: string): Tokens {
    const accessToken = random();
    const refreshToken = random();
    this.state.access[hash(accessToken)] = { family, expires: this.now() + ACCESS_MS };
    this.state.refresh[hash(refreshToken)] = { family, expires: this.now() + REFRESH_MS };
    this.cleanup();
    this.persist();
    return {
      token_type: 'Bearer', access_token: accessToken,
      refresh_token: refreshToken, expires_in: ACCESS_MS / 1000,
    };
  }

  private cleanup(): void {
    let codesChanged = false;
    for (const [id, code] of Object.entries(this.codes)) {
      if (!code || code.expires < this.now()) {
        delete this.codes[id];
        codesChanged = true;
      }
    }
    if (codesChanged) this.persistCodes();
    for (const bucket of [this.state.access, this.state.refresh]) {
      for (const [id, item] of Object.entries(bucket)) {
        if (item.expires < this.now()) delete bucket[id];
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const temp = this.stateFile + '.tmp';
    writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(temp, this.stateFile);
  }

  private persistCodes(): void {
    mkdirSync(dirname(this.codeFile), { recursive: true });
    const temp = this.codeFile + '.tmp';
    writeFileSync(temp, JSON.stringify(this.codes), { mode: 0o600 });
    renameSync(temp, this.codeFile);
  }
}
