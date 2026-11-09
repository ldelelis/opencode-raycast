import { useCallback, useEffect, useRef, useState } from "react";
import { basename } from "node:path";
import {
  Action, ActionPanel, closeMainWindow, getApplications, Icon, List, open, showToast, Toast,
} from "@raycast/api";
import { connect, openSession } from "./opencode";
import { readSessionCache, rememberSessions, type SessionSummary } from "./session-cache";

type SearchResults = { query: string; sessions: SessionSummary[]; next?: string };

export default function SearchSessions() {
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [index, setIndex] = useState(readSessionCache);
  const known = useRef(index);
  const [results, setResults] = useState<SearchResults>();
  const latestResults = useRef<SearchResults>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController>(undefined);
  const fetching = useRef(false);
  const client = useRef<Awaited<ReturnType<typeof connect>>>(undefined);
  const search = query.trim();

  const load = useCallback(async (next: string | undefined, signal: AbortSignal) => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const connection = client.current ?? await connect();
      if (signal.aborted) return;
      client.current = connection;
      const page = await connection.session.list(next
        ? { cursor: next, limit: 100 }
        : { search: search || undefined, archived: false, parentID: null, order: "desc", limit: 100 },
      { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (signal.aborted) return;
      const found = page.data.map((session) => ({
        id: session.id,
        title: session.title || "Untitled session",
        directory: session.location.directory,
        updatedAt: session.time.updated,
      }));
      const previous = next ? latestResults.current?.sessions ?? [] : [];
      const current = { query: search, sessions: [...previous, ...found], next: page.cursor.next ?? undefined };
      latestResults.current = current;
      setResults(current);
      known.current = rememberSessions(known.current, current.sessions, search, !current.next);
      setIndex(known.current);
      setError("");
    } catch (cause) {
      if (!signal.aborted) {
        client.current = undefined;
        setError(cause instanceof Error ? cause.message : "Could not load sessions");
      }
    } finally {
      if (!signal.aborted) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    fetching.current = false;
    latestResults.current = undefined;
    setResults(undefined);
    setError("");
    setLoading(true);
    const timer = setTimeout(() => void load(undefined, controller.signal), search ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, revision, search]);

  const refresh = () => setRevision((value) => value + 1);
  const launch = async (session: SessionSummary) => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Opening session…" });
    try {
      await openSession(session.id);
      await toast.hide();
      await closeMainWindow();
    } catch (cause) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could not open session";
      toast.message = cause instanceof Error ? cause.message : String(cause);
    }
  };

  const current = results?.query === search ? results : undefined;
  const visible = new Map(index
    .filter((session) => session.title.toLowerCase().includes(search.toLowerCase()))
    .map((session) => [session.id, session]));
  for (const session of current?.sessions ?? []) visible.set(session.id, session);
  const sessions = [...visible.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <List
      isLoading={loading}
      filtering={false}
      searchBarPlaceholder="Search session titles…"
      onSearchTextChange={setQuery}
      navigationTitle={error && sessions.length > 0 ? "OpenCode · Cached sessions (refresh failed)" : "OpenCode sessions"}
      pagination={{
        hasMore: !!current?.next && !error,
        pageSize: 100,
        onLoadMore: () => { if (current?.next && active.current) void load(current.next, active.current.signal); },
      }}
    >
      {error ? <List.EmptyView icon={Icon.ExclamationMark} title="Could not load sessions" description={error}
        actions={<ActionPanel>
          <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
          <Action title="Launch OpenCode Desktop" icon={Icon.Desktop} onAction={async () => {
            const application = (await getApplications()).find((application) => application.name === "OpenCode");
            if (!application) {
              await showToast({ style: Toast.Style.Failure, title: "OpenCode Desktop is not installed" });
              return;
            }
            await open(application.path);
          }} />
        </ActionPanel>}
      /> : <List.EmptyView icon={Icon.MagnifyingGlass} title={loading ? "Loading sessions…" : "No sessions found"} />}
      {sessions.map((session) => (
        <List.Item
          key={session.id}
          icon={Icon.Message}
          title={session.title || "Untitled session"}
          subtitle={basename(session.directory)}
          accessories={[
            { date: new Date(session.updatedAt), tooltip: `Updated · ${session.directory}` },
          ]}
          actions={<ActionPanel>
            <Action title="Open in OpenCode Desktop" icon={Icon.Desktop} onAction={() => launch(session)} />
            <Action.CopyToClipboard title="Copy Session ID" content={session.id} shortcut={{ modifiers: ["cmd"], key: "c" }} />
            <Action.CopyToClipboard title="Copy Project Directory" content={session.directory} />
            <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} shortcut={{ modifiers: ["cmd"], key: "r" }} />
          </ActionPanel>}
        />
      ))}
    </List>
  );
}
