# OpenCode Desktop sessions for Raycast

Search local OpenCode V2 session titles in Raycast and open the selected session in Desktop. Results show the project and last-updated time. Enter opens the session, ⌘C copies its ID, and ⌘R refreshes. Archived sessions and child/subagent sessions are excluded.

## Install locally

Requires Node 22+, npm, Raycast, and OpenCode Desktop 2.2.6 or a compatible V2 release.

```sh
git clone https://github.com/ldelelis/opencode-raycast.git "$HOME/opencode-raycast"
cd "$HOME/opencode-raycast"
npm install
npm run build
```

Add the companion plugin to the existing `plugins` array in your global OpenCode `opencode.json(c)`, preserving its other entries. The default config directory is `$HOME/.config/opencode`, or `$XDG_CONFIG_HOME/opencode` when set:

```jsonc
{
  "plugins": [
    "{env:HOME}/opencode-raycast/plugin"
  ]
}
```

If you clone elsewhere, use that checkout's `plugin` directory instead. OpenCode reloads configuration automatically. Check **Settings → Extensions → Plugins** to confirm Session Launcher is enabled. Then use Raycast's **Import Extension** command and choose the `raycast` directory, or run `npm run dev` from this project.

Desktop must be running with at least one window open. If it is closed, launch it and refresh the search. This extension does not start or replace a background service. It uses the supported `Service.discover()` and `Service.headers()` APIs, so there is no port, password, or database configuration to maintain. Remote servers are not included.

## Bridge

The companion exposes `session-launcher.openSession({ sessionID })` through OpenCode's authenticated plugin RPC API. Raycast calls it in the home-directory location. The server verifies that the session exists, holds an in-memory request for up to ten seconds, and emits a request event. Desktop's single main-process handler assigns the request to its focused window (or first window). A per-window IPC snapshot delivers it to the renderer, which uses `ctx.tabs.open({ server: "sidecar", id }, { focus: true })`. Main restores/focuses that window and acknowledges the request to the server. Raycast reports success only after acknowledgement.

Pending requests are polled every second as well as on events, so a dropped event or server reconnection does not permanently lose a request. Requests expire rather than unexpectedly opening sessions much later. They are not persisted. Existing session tabs are reused. No HTTP listener, UI scripting, custom URL scheme, or OpenCode core modification is required.

The API also exposes `pending()` and `complete({ requestID, error? })` for the Desktop delivery bridge. They use the same local service authentication as other OpenCode APIs; they are not unauthenticated public endpoints.

## Development

```sh
npm run typecheck
npm run build --workspace plugin
npm run dev --workspace plugin  # rebuild the GUI on changes
npm run dev                   # run the Raycast extension
```

The GUI plugin API is experimental and pinned to OpenCode 2.2.6. Rebuild and recheck compatibility when upgrading OpenCode.
