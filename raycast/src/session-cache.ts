import { Cache } from "@raycast/api";
import { z } from "zod";

const summary = z.object({
  id: z.string(),
  title: z.string(),
  directory: z.string(),
  updatedAt: z.number().finite(),
});

export type SessionSummary = z.infer<typeof summary>;

const cache = new Cache({ namespace: "session-list-v1" });
const archivedCache = new Cache({ namespace: "archived-session-list-v1" });
const summaries = z.array(summary).max(1000);

export function readSessionCache(archived: boolean): SessionSummary[] {
  try {
    const stored = (archived ? archivedCache : cache).get("sessions");
    return stored ? summaries.parse(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

export function rememberSessions(
  previous: SessionSummary[],
  results: SessionSummary[],
  options: { query: string; complete: boolean; archived: boolean },
): SessionSummary[] {
  const incoming = new Map(results.map((session) => [session.id, session]));
  const retained = previous.filter((session) =>
    !options.complete || !session.title.toLowerCase().includes(options.query.toLowerCase()) || incoming.has(session.id));
  const merged = new Map(retained.map((session) => [session.id, session]));
  for (const session of results) merged.set(session.id, session);
  const next = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1000);
  try {
    (options.archived ? archivedCache : cache).set("sessions", JSON.stringify(next));
  } catch {
    console.warn("[session-launcher] Could not persist the session cache");
  }
  return next;
}
