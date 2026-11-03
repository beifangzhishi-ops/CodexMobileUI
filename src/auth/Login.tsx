import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import type { Host } from '../core/host';
import { CLIENT_ID, REDIRECT_URI, storeTokens } from './tokens';

WebBrowser.maybeCompleteAuthSession();

export function OAuthLogin({
  host, onConnected,
}: { host: Host; onConnected: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const discovery = useMemo(() => ({
    authorizationEndpoint: host.baseUrl + '/oauth/authorize',
    tokenEndpoint: host.baseUrl + '/oauth/token',
    revocationEndpoint: host.baseUrl + '/oauth/revoke',
  }), [host.baseUrl]);
  const [request, response, promptAsync] = AuthSession.useAuthRequest({
    clientId: CLIENT_ID,
    redirectUri: AuthSession.makeRedirectUri({ native: REDIRECT_URI }),
    responseType: AuthSession.ResponseType.Code,
    scopes: [],
    usePKCE: true,
  }, discovery);

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) return;
    let cancelled = false;
    setSaving(true);
    void AuthSession.exchangeCodeAsync({
      clientId: CLIENT_ID,
      code: response.params.code,
      redirectUri: request.redirectUri,
      extraParams: { code_verifier: request.codeVerifier },
    }, discovery)
      .then(async (tokens) => {
        if (cancelled) return;
        await storeTokens(host, {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken ?? '',
          expires_in: tokens.expiresIn ?? 900,
        });
        onConnected();
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'OAuth 失败'); })
      .finally(() => { if (!cancelled) setSaving(false); });
    return () => { cancelled = true; };
  }, [response, request, host, discovery, onConnected]);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>连接 {host.name}</Text>
      <Text style={styles.subtitle}>使用浏览器完成本电脑的 OAuth 授权。不会将 Codex 凭据复制到手机。</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        disabled={!request || saving}
        onPress={() => { setError(null); void promptAsync(); }}
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
