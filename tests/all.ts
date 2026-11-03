// Explicit in-process test runner. Works in restricted Windows CI sandboxes
// where Node's --test subprocess runner cannot spawn workers.
import './protocol.test';
import './oauth.test';
import './gateway.test';
