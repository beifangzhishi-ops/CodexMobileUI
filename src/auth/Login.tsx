import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Host } from '../core/host';
import { CLIENT_ID, REDIRECT_URI, storeTokens } from './tokens';
import { getAuthorizedCode } from './authorizationResult';

WebBrowser.maybeCompleteAuthSession();

export function OAuthLogin({
  host, onConnected,
}: { host: Host; onConnected: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('');
  const inProgress = useRef(false);
  const currentHost = useRef(host.id);
  currentHost.current = host.id;
  const discovery = useMemo(() => ({
    authorizationEndpoint: host.baseUrl + '/oauth/authorize',
    tokenEndpoint: host.baseUrl + '/oauth/token',
    revocationEndpoint: host.baseUrl + '/oauth/revoke',
  }), [host.baseUrl]);
  const [request, , promptAsync] = AuthSession.useAuthRequest({
    clientId: CLIENT_ID,
    redirectUri: AuthSession.makeRedirectUri({ native: REDIRECT_URI }),
    responseType: AuthSession.ResponseType.Code,
    scopes: [],
    usePKCE: true,
  }, discovery);

  // Handle exactly the result of the browser invocation the user tapped.
  // A prop callback changing after render must not cancel a completed code exchange.
  const authorize = async () => {
    if (!request || !request.codeVerifier || inProgress.current) return;
    const startedFor = host.id;
    inProgress.current = true;
    setSaving(true);
    setError(null);
    setPhase('正在打开浏览器并等待授权…');
    try {
      const result = await promptAsync();
      if (currentHost.current !== startedFor) return;
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setError('授权未完成。可以重新点击授权，创建新的请求。');
        return;
      }
      if (result.type !== 'success') {
        setError('授权未完成，请重新发起。' +
          (result.type === 'error' ? ' 浏览器返回了 OAuth 错误。' : ''));
        return;
      }
      const code = getAuthorizedCode(result, request.state);
      if (!code) throw new Error('OAuth 授权没有返回授权码。');
      setPhase('正在交换授权码…');
      const tokens = await AuthSession.exchangeCodeAsync({
        clientId: CLIENT_ID,
        code,
        redirectUri: request.redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      }, discovery);
      if (!tokens.refreshToken || !tokens.accessToken) {
        throw new Error('电脑未返回有效的 OAuth 令牌，请重新授权。');
      }
      if (currentHost.current !== startedFor) return;
      setPhase('正在安全保存授权…');
      await storeTokens(host, {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn ?? 900,
      });
      if (currentHost.current === startedFor) onConnected();
    } catch (e: unknown) {
      if (currentHost.current === startedFor) {
        setError(e instanceof Error ? e.message : 'OAuth 授权失败，请重试。');
      }
    } finally {
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
        disabled={!request || saving}
        onPress={() => { void authorize(); }}
        style={[styles.button, (!request || saving) && styles.disabled]}
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
