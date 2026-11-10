/** Host identity is shared with OAuth; conversation caches are not.
 * The private Codex home starts with a new independent thread database. */
export function isolatedHostCacheKey(hostId: string): string {
  if (!hostId) throw new Error('Host identity is required for private conversation cache');
  return 'codexmobileui-private:' + hostId;
}
