import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Host } from '../core/host';
import { CLIENT_ID, REDIRECT_URI, storeTokens } from './tokens';
import { getAuthorizedCode } from './authorizationResult';
import { classifyDiagnosticError } from '../diagnostics/safe';
import { logDiagnostic } from '../diagnostics/journal';

WebBrowser.maybeCompleteAuthSession();

export function OAuthLogin({
  host, onConnected,
}: { host: Host; onConnected: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('');
  const inProgress = useRef(false);
  const tapCount = useRef(0);
  const currentHost = useRef(host.id);
  currentHost.current = host.id;
  const discovery = useMemo(() => ({
    authorizationEndpoint: host.baseUrl + '/oauth/authorize',
    tokenEndpoint: host.baseUrl + '/oauth/token',
    revocationEndpoint: host.baseUrl + '/oauth/revoke',
  }), [host.baseUrl]);
  // Create a fresh request on every tap, rather than waiting for an invisible
  // preloaded hook request or reusing its PKCE state after a dismissed browser.
  const authorize = async () => {
    const attempt = ++tapCount.current;
    logDiagnostic('auth.buttonPressed', {
      attempt, inProgress: inProgress.current, buttonEnabled: !saving,
    });
    if (inProgress.current) {
      logDiagnostic('auth.duplicateBlocked', { attempt });
      return;
    }
    const startedAt = Date.now();
    const startedFor = host.id;
    inProgress.current = true;
    setSaving(true);
    setError(null);
    logDiagnostic('auth.requestStarted', { attempt });
    setPhase('正在创建新的安全授权请求…');
    try {
      logDiagnostic('auth.pkceCreating', { attempt });
      const request = new AuthSession.AuthRequest({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code,
        scopes: [],
        usePKCE: true,
      });
      logDiagnostic('auth.pkceCreated', { attempt, codePresent: Boolean(request.codeVerifier) });
      await request.makeAuthUrlAsync(discovery);
      logDiagnostic('auth.urlCreated', { attempt, codePresent: Boolean(request.codeVerifier) });
      if (!request.codeVerifier) throw new Error('未能生成安全授权参数，请重新尝试。');
      if (currentHost.current !== startedFor) return;
      setPhase('正在打开浏览器，请在网页上输入本机授权密钥…');
      logDiagnostic('auth.browserPromptStarted', { attempt });
      // Native browser resolves only after redirect/cancel; a pending event
      // distinguishes a stalled native call from a missed button press.
      const pendingProbe = setTimeout(() => {
        logDiagnostic('auth.browserStillPending', { attempt, durationMs: Date.now() - startedAt });
      }, 15000);
      let result: AuthSession.AuthSessionResult;
      try {
        result = await request.promptAsync(discovery);
      } finally {
        clearTimeout(pendingProbe);
      }
      logDiagnostic('auth.browserPromptFinished', {
        attempt, result: result.type, durationMs: Date.now() - startedAt,
      });
      if (currentHost.current !== startedFor) return;
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setError('浏览器已关闭，授权尚未完成。重新点击即可创建新的授权请求。');
        return;
      }
      if (result.type === 'locked') {
        setError('系统中还有一个授权浏览器正在运行。请关闭旧授权页，再点击重试。');
        return;
      }
      if (result.type !== 'success') {
        setError(result.type === 'error' ?
          '授权回跳被拒绝，请重新点击授权。' :
          '浏览器未完成回跳，请关闭授权页后重试。');
        return;
      }
      const code = getAuthorizedCode(result, request.state);
      logDiagnostic('auth.callbackValidated', { attempt, codePresent: Boolean(code), stateMatches: Boolean(code) });
      if (!code) throw new Error('OAuth 授权没有返回授权码。');
      setPhase('正在交换授权码…');
      logDiagnostic('auth.tokenExchangeStarted', { attempt });
      const tokens = await AuthSession.exchangeCodeAsync({
        clientId: CLIENT_ID,
        code,
        redirectUri: request.redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      }, discovery);
      logDiagnostic('auth.tokenExchangeFinished', {
        attempt, codePresent: Boolean(tokens.accessToken && tokens.refreshToken),
      });
      if (!tokens.refreshToken || !tokens.accessToken) {
        throw new Error('电脑未返回有效的 OAuth 令牌，请重新授权。');
      }
      if (currentHost.current !== startedFor) return;
      setPhase('正在安全保存授权…');
      logDiagnostic('auth.tokenStorageStarted', { attempt });
      await storeTokens(host, {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn ?? 900,
      });
      logDiagnostic('auth.tokenStorageFinished', { attempt });
      if (currentHost.current === startedFor) {
        logDiagnostic('auth.connected', { attempt, durationMs: Date.now() - startedAt });
        onConnected();
      }
    } catch (e: unknown) {
      logDiagnostic('auth.failed', {
        attempt, durationMs: Date.now() - startedAt, ...classifyDiagnosticError(e),
      });
      if (currentHost.current === startedFor) {
        setError(e instanceof Error ? e.message : 'OAuth 授权失败，请重试。');
      }
    } finally {
      logDiagnostic('auth.attemptFinished', { attempt, durationMs: Date.now() - startedAt });
      inProgress.current = false;
      if (currentHost.current === startedFor) {
        setPhase('');
        setSaving(false);
      }
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>连接 {host.name}</Text>
      <Text style={styles.subtitle}>使用浏览器完成本电脑的 OAuth 授权。不会将 Codex 凭据复制到手机。</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saving ? <Text style={styles.subtitle}>{phase}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="使用 OAuth 授权"
        onPressIn={() => logDiagnostic('auth.pressIn', {
          buttonEnabled: !saving, inProgress: inProgress.current,
        })}
        disabled={saving}
        onPress={() => { void authorize(); }}
        style={[styles.button, saving && styles.disabled]}
      >
        {saving ? <ActivityIndicator color="#162337" /> : <Text style={styles.buttonText}>使用 OAuth 授权</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#e9eef7' },
  subtitle: { fontSize: 14, color: '#a5b4c6', lineHeight: 22 },
  error: { color: '#ff9696' },
  button: { borderRadius: 14, padding: 14, backgroundColor: '#b8d1f9', alignItems: 'center' },
  buttonText: { color: '#13253b', fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
