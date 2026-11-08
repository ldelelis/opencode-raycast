import { homedir } from "node:os";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { Launcher } from "opencode-session-launcher/rpc";

export async function connect() {
  const endpoint = await Service.discover({ version: (version) => version.startsWith("2.") });
  if (!endpoint) throw new Error("Open OpenCode Desktop first, then refresh this list.");
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
}

export async function openSession(sessionID: string) {
  const client = await connect();
  try {
    await client.rpc(Launcher).openSession({ sessionID }, {
      location: { directory: homedir() },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Open request failed";
    throw new Error(`Enable Session Launcher in OpenCode Desktop. ${detail}`);
  }
}
