// Explicit in-process test runner. Works in restricted Windows CI sandboxes
// where Node's --test subprocess runner cannot spawn workers.
import './protocol.test';
import './thread-api.test';
import './project-api.test';
import './first-send.test';
import './title-generator.test';
import './workspace.test';
import './rpc-policy.test';
import './storage.test';
import './profile.test';
import './oauth.test';
import './authorization-result.test';
import './diagnostics.test';
import './gateway-diagnostics.test';
import './gateway.test';
