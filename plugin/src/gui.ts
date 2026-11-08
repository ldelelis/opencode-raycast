import { homedir } from "node:os";
import { Schema } from "effect";
import { Ipc, Plugin } from "@opencode/plugin/gui";
import { createEffect } from "solid-js";
import { Launcher, type OpenRequest } from "./rpc.ts";

const Request = Schema.Struct({ requestID: Schema.String, sessionID: Schema.String, expiresAt: Schema.Number });
const Desktop = Ipc.define({
  id: "session-launcher.desktop",
  state: Schema.Array(Request),
  methods: {
    complete: {
      input: Schema.Struct({ requestID: Schema.String, error: Schema.optional(Schema.String) }),
    },
  },
});

export default Plugin.define({
  setup(ctx) {
    if (ctx.app.platform !== "desktop") return;
    const desktop = ctx.main(Desktop);
    const handled = new Set<string>();
    createEffect(() => {
      const server = ctx.servers.get("sidecar");
      const requests = desktop.state() ?? [];
      const live = new Set(requests.map((request) => request.requestID));
      for (const id of handled) if (!live.has(id)) handled.delete(id);
      if (!server?.connected) return;

      for (const request of requests) {
        if (handled.has(request.requestID) || request.expiresAt <= Date.now()) continue;
        handled.add(request.requestID);
        let error: string | undefined;
        try {
          ctx.tabs.open({ server: server.id, id: request.sessionID }, { focus: true });
        } catch {
          error = "Desktop could not open the session";
        }
        void desktop.complete({ requestID: request.requestID, error }).catch((cause) => {
          console.warn("[session-launcher] Could not acknowledge session open", cause);
        });
      }
    });
  },
  main(ctx) {
    const location = { directory: homedir() };
    let pending: OpenRequest[] = [];
    const owners = new Map<string, number>();
    const completed = new Map<string, number>();
    const provider = ctx.provide(Desktop, {
      state: (window) => pending.filter((request) => owners.get(request.requestID) === window),
      complete: async (input, caller) => {
        if (owners.get(input.requestID) !== caller.window) return;
        const request = pending.find((request) => request.requestID === input.requestID);
        if (!request || request.expiresAt <= Date.now()) return;
        if (!input.error) {
          const window = ctx.windows.get(caller.window);
          if (!window) throw new Error("Desktop window closed");
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
        await ctx.client.rpc(Launcher).complete(input, { location, signal: ctx.signal });
        completed.set(input.requestID, request.expiresAt);
        owners.delete(input.requestID);
        pending = pending.filter((request) => request.requestID !== input.requestID);
        provider.changed();
      },
    });

    let refreshing = false;
    const refresh = async () => {
      if (refreshing || ctx.signal.aborted) return;
      refreshing = true;
      try {
        const snapshot = await ctx.client.rpc(Launcher).pending({}, {
          location,
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(4000)]),
        });
        for (const [id, expiry] of completed) if (expiry <= Date.now()) completed.delete(id);
        // A poll started before acknowledgement must not deliver the completed request again.
        const requests = snapshot.filter((request) => !completed.has(request.requestID));
        const live = new Set(requests.map((request) => request.requestID));
        for (const id of owners.keys()) if (!live.has(id)) owners.delete(id);
        const target = ctx.windows.focused() ?? ctx.windows.list()[0];
        for (const request of requests) {
          const owner = owners.get(request.requestID);
          if ((!owner || !ctx.windows.get(owner)) && target) owners.set(request.requestID, target.id);
        }
        pending = requests;
        provider.changed();
      } catch {
        // The next tick re-discovers the client after a service restart.
      } finally {
        refreshing = false;
      }
    };

    let client = ctx.client;
    let unsubscribe = () => {};
    const subscribe = () => {
      unsubscribe();
      client = ctx.client;
      unsubscribe = client.rpc(Launcher).events.on("requested", (event) => {
        if (event.location.directory === location.directory) void refresh();
      });
    };
    subscribe();
    const timer = setInterval(() => {
      if (ctx.client !== client) subscribe();
      void refresh();
    }, 1000);
    void refresh();
    return () => {
      clearInterval(timer);
      unsubscribe();
      provider.dispose();
    };
  },
});
