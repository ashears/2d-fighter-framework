# Direct rooms for 2D Fighter Framework

`@ashears/fighter-direct` runs a private match in the host browser and uses a WebRTC data channel for input and snapshots. A static site can use it without a signaling server, STUN/TURN, or a running WebSocket service.

Pass a game ID, fighter IDs, arena IDs, rule IDs, and a match configuration factory to `DirectRoomConnection`. Its second argument receives room and match messages from the shared protocol. Its third argument receives connection failures. The optional fourth argument accepts WebRTC ICE servers. Add STUN for public address discovery and TURN to relay traffic when a direct route is blocked.

1. The host calls `invite(stage, rule)` and shares the resulting string.
2. The guest calls `reply(invite)` and returns the resulting string.
3. The host calls `accept(reply)`. The connection emits a room message to both browsers when ready.
4. Use `send(message)` for player selection, readiness, match inputs, rematch, and leave. Call `close()` when leaving the screen and on `pagehide`.

Serve the frontend over HTTPS or use localhost. Both players should start on the same Wi-Fi. Network isolation and NAT can prevent direct connectivity. The host keeps the game tab open during the match.
