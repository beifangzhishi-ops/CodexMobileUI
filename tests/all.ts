// Explicit in-process test runner. Works in restricted Windows CI sandboxes
// where Node's --test subprocess runner cannot spawn workers.
import './context-usage.test';
import './unified-web.test';
import './publications.test';
import './redact-diff.test';
import './approval-bridge.test';
import './native-permission.test';
import './web-title-service.test';
import './workspace.test';
import './project-directories.test';
import './host-files.test';
import './rpc-policy.test';
import './rate-limits.test';
import './profile.test';
import './oauth.test';
import './gateway-diagnostics.test';
import './gateway.test';
import './scheduler.test';
import './sidebar-pins.test';
import './tool-images.test';
