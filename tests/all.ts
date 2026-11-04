// Explicit in-process test runner. Works in restricted Windows CI sandboxes
// where Node's --test subprocess runner cannot spawn workers.
import './protocol.test';
import './thread-api.test';
import './rpc-policy.test';
import './storage.test';
import './oauth.test';
import './authorization-result.test';
import './gateway.test';
