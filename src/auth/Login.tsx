import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Host } from '../core/host';
import { CLIENT_ID, REDIRECT_URI, storeTokens } from './tokens';
import { getAuthorizedCode } from './authorizationResult';
import { palette } from '../ui/theme';

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
  // Create a fresh request on every tap, rather than waiting for an invisible
  // preloaded hook request or reusing its PKCE state after a dismissed browser.
  const authorize = async () => {
    if (inProgress.current) return;
    const startedFor = host.id;
    inProgress.current = true;
    setSaving(true);
    setError(null);
    setPhase('正在创建新的安全授权请求…');
    try {
      const request = new AuthSession.AuthRequest({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code,
        scopes: [],
        usePKCE: true,
      });
      await request.makeAuthUrlAsync(discovery);
      if (!request.codeVerifier) throw new Error('未能生成安全授权参数，请重新尝试。');
      if (currentHost.current !== startedFor) return;
      setPhase('正在打开浏览器，请在网页上输入本机授权密钥…');
      const result = await request.promptAsync(discovery);
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
        accessibilityRole="button"
        accessibilityLabel="使用 OAuth 授权"
        disabled={saving}
        onPress={() => { void authorize(); }}
        style={[styles.button, saving && styles.disabled]}
      >
        {saving ? <ActivityIndicator color={palette.canvas} /> : <Text style={styles.buttonText}>使用 OAuth 授权</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingVertical: 12, gap: 14 },
  title: { fontSize: 18, fontWeight: '600', color: palette.text },
  subtitle: { fontSize: 14, color: palette.subtle, lineHeight: 21 },
  error: { color: '#ffa2a2', fontSize: 14 },
  button: { borderRadius: 14, padding: 14, backgroundColor: palette.white, alignItems: 'center' },
  buttonText: { color: palette.canvas, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
