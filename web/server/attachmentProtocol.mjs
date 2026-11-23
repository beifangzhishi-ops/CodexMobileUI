/**
 * Validate the browser-facing document-upload envelope before passing it to
 * the existing per-connection Gateway attachment uploader.
 *
 * An upload ID is scoped to one socket; no client may choose a host path.
 */
const extension = /\.(?:txt|md|json|jsonl|csv|log|yaml|yml|xml|js|jsx|ts|tsx|py|html|css|sh|ps1|java|kt|rs|go|c|cpp|h|pdf|docx|xlsx|pptx|zip)$/i;
const uploadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chunkBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const exact = (object, fields) => Object.keys(object).length === fields.length &&
  Object.keys(object).every((key) => fields.includes(key));

export function validDocumentUploadRpc(method, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  switch (method) {
    case 'web/attachment/start':
      return exact(params, ['name', 'size']) &&
        typeof params.name === 'string' && params.name.length >= 1 && params.name.length <= 100 &&
        !/[\\/\x00-\x1f]/.test(params.name) && extension.test(params.name) &&
        Number.isSafeInteger(params.size) && params.size > 0 && params.size <= 8 * 1024 * 1024;
    case 'web/attachment/chunk':
      return exact(params, ['uploadId', 'index', 'data']) &&
        typeof params.uploadId === 'string' && uploadId.test(params.uploadId) &&
        Number.isSafeInteger(params.index) && params.index >= 0 && params.index < 256 &&
        typeof params.data === 'string' && params.data.length >= 4 &&
        params.data.length <= Math.ceil(65536 / 3) * 4 &&
        chunkBase64.test(params.data);
    case 'web/attachment/finish':
    case 'web/attachment/cancel':
      return exact(params, ['uploadId']) &&
        typeof params.uploadId === 'string' && uploadId.test(params.uploadId);
    default: return false;
  }
}

export function documentUploadGatewayMethod(method) {
  switch (method) {
    case 'web/attachment/start': return 'workspace/attachmentStart';
    case 'web/attachment/chunk': return 'workspace/attachmentChunk';
    case 'web/attachment/finish': return 'workspace/attachmentFinish';
    case 'web/attachment/cancel': return 'workspace/attachmentCancel';
    default: return null;
  }
}
