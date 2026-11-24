// Native model ids may be namespaced (for example ds/deepseek-flash).
// Permit catalog-style segments, not arbitrary paths or URL characters.
export function validModelIdentifier(value) {
  return typeof value === 'string' && value.length <= 80 &&
    /^[\w.-]+(?:\/[\w.-]+)*$/.test(value) &&
    !value.split('/').some((segment) => segment === '.' || segment === '..');
}
