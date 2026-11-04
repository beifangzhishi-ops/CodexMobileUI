/** Pure callback validation; never accepts an OAuth code without matching state. */
export function getAuthorizedCode(
  result: { type: string; params?: Record<string, string | undefined> },
  expectedState: string,
): string | null {
  if (result.type !== 'success') return null;
  if (!result.params?.code || !expectedState || result.params.state !== expectedState) {
    throw new Error('OAuth 回跳参数不匹配，请重新发起授权。');
  }
  return result.params.code;
}
