# Direct rooms for 2D Fighter Framework

`@ashears/fighter-direct` runs a private match in the host browser and uses a WebRTC data channel for input and snapshots. A static site can use it without a signaling server, STUN/TURN, or a running WebSocket service.

Pass a game ID, fighter IDs, arena IDs, rule IDs, and a match configuration factory to `DirectRoomConnection`. Its second argument receives room and match messages from the shared protocol. Its third argument receives connection failures. The optional fourth argument accepts WebRTC ICE servers. Add STUN for public address discovery and TURN to relay traffic when a direct route is blocked.

1. The host calls `invite(stage, rule)` and passes the offer to `createInviteLink(location.href, offer)` to make a URL. Call `copyInviteLink(linkPromise)` from the same click event to copy the URL once the offer is ready. If copying fails, display the URL so the host can copy it manually.
2. On page load, call `readInviteLink(location.href)`. If it returns an offer, open the lobby, clear the fragment with `history.replaceState`, and call `reply(offer)`. The guest shares the resulting reply code with the host. `reply` also accepts a pasted invite URL.
3. The host calls `accept(reply)`. The connection emits a room message to both browsers when ready.
4. Use `send(message)` for player selection, readiness, match inputs, rematch, and leave. Call `close()` when leaving the screen and on `pagehide`.

Serve the frontend over HTTPS or use localhost. Both players should start on the same Wi-Fi. Network isolation and NAT can prevent direct connectivity. The host keeps the game tab open during the match.
