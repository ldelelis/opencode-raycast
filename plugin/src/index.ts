import { randomUUID } from "node:crypto";
import { Plugin } from "@opencode/plugin";
import { Launcher, type OpenRequest } from "./rpc.ts";

export default Plugin.define({
  id: "session-launcher",
  async setup(ctx) {
    const pending = new Map<string, {
      request: OpenRequest;
      finish: (error?: string) => void;
    }>();

    const registration = await ctx.rpc.register(Launcher, {
      openSession: async ({ sessionID }, call) => {
        await ctx.session.get({ sessionID }, { signal: call.signal });
        if (call.signal.aborted) throw new Error("Open request cancelled");
        const request = { requestID: randomUUID(), sessionID, expiresAt: Date.now() + 10_000 };
        const result = await new Promise<string | undefined>((resolve) => {
          const finish = (error?: string) => {
            if (!pending.delete(request.requestID)) return;
            clearTimeout(timer);
            call.signal.removeEventListener("abort", cancelled);
            resolve(error);
          };
          const cancelled = () => finish("Open request cancelled");
          const timer = setTimeout(() => finish("Desktop did not respond. Open OpenCode Desktop and enable Session Launcher."), 10_000);
          pending.set(request.requestID, { request, finish });
          call.signal.addEventListener("abort", cancelled, { once: true });
          if (call.signal.aborted) return cancelled();
          void registration.events.emit("requested", request).catch(() => {});
        });
        if (result) return call.error("open_failed", result, {});
        return {};
      },
      pending: async () => [...pending.values()].map((item) => item.request),
      complete: async ({ requestID, error }) => {
        pending.get(requestID)?.finish(error);
        return {};
      },
    });

    return async () => {
      for (const item of pending.values()) item.finish("Session Launcher was unloaded");
      await registration.dispose();
    };
  },
});
