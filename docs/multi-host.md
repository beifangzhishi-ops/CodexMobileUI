# Private multi-host configuration

6v is the single browser entry point. A Web Agent on each remote host owns its
native App Server connection and local Gateway operations. The Coordinator
selects a route by the registered host ID; the file owner alone prepares a
snapshot and the Coordinator forwards its bytes. The browser receives only
host IDs and display names, not peer URLs or credentials.

The existing peerUrl and .state/web-peer-token remain compatible for noha.
For a registry with more peers, configure the Coordinator's private
.state/web-bridge.json with a peers array:

    {
      "peers": [
        { "id": "noha", "displayName": "noha", "peerUrl": "ws://100.96.30.32:4191/peer" },
        { "id": "third-pc", "displayName": "Third PC", "peerUrl": "ws://100.90.10.11:4191/peer" }
      ]
    }

Keep the existing origin and other private configuration fields. The example
third address is illustrative, not a deployed host. Each peer requires a
different 64-character lowercase hexadecimal token in the Coordinator's
.state/web-peer-<id>.token and the matching peer's private
.state/web-peer-token. Configure the peer's own .state/web-bridge.json
with its stable hostId and validated Tailscale endpoint settings. Never
commit real tokens or private state. Deploy the existing independent App Server,
Gateway and Web Agent before registration. Reload the Coordinator after changing
its registry; reload the shared client to discover the new roster.

An optional C-drive SMB mapping for each host can be configured in shared Web
settings. Only registered hosts and private IPs are accepted on save; missing
mappings never invent an UNC location. The file snapshot path works independently
of SMB mapping.

## Current limits

The 3% shared quota guard still uses the existing 6v/noha two-host protocol.
The Coordinator rejects additional-peer model work while the guard is enabled
and rejects enabling that guard on an expanded roster. Do not treat this as
multi-host quota monitoring. Android background notification routing still recognizes the original two hosts;
the shared Web UI and private snapshot transfers use dynamic routing. Adding
a physical third host requires verifying these native features and the
independent Gateway setup before broad rollout.
