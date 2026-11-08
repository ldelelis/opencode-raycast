import { useCallback, useEffect, useRef, useState } from "react";
import { basename } from "node:path";
import {
  Action, ActionPanel, closeMainWindow, getApplications, Icon, List, open, showToast, Toast,
} from "@raycast/api";
import type { SessionInfo } from "@opencode/client";
import { connect, openSession } from "./opencode";

export default function SearchSessions() {
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController>(undefined);
  const fetching = useRef(false);

  const load = useCallback(async (next: string | undefined, signal: AbortSignal) => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const client = await connect();
      if (signal.aborted) return;
      const page = await client.session.list(next
        ? { cursor: next, limit: 100 }
        : { search: query.trim() || undefined, archived: false, parentID: null, order: "desc", limit: 100 },
      { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (signal.aborted) return;
      setSessions((previous) => next ? [...previous, ...page.data] : page.data);
      setCursor(page.cursor.next ?? undefined);
      setError("");
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load sessions");
    } finally {
      if (!signal.aborted) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    fetching.current = false;
    setSessions([]);
    setCursor(undefined);
    setError("");
    setLoading(true);
    const timer = setTimeout(() => void load(undefined, controller.signal), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, revision]);

  const refresh = () => setRevision((value) => value + 1);
  const launch = async (session: SessionInfo) => {
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

  return (
    <List
      isLoading={loading}
      filtering={false}
      searchBarPlaceholder="Search session titles…"
      onSearchTextChange={setQuery}
      pagination={{
        hasMore: !!cursor && !error,
        pageSize: 100,
        onLoadMore: () => { if (cursor && active.current) void load(cursor, active.current.signal); },
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
          subtitle={basename(session.location.directory)}
          accessories={[
            { date: new Date(session.time.updated), tooltip: `Updated · ${session.location.directory}` },
          ]}
          actions={<ActionPanel>
            <Action title="Open in OpenCode Desktop" icon={Icon.Desktop} onAction={() => launch(session)} />
            <Action.CopyToClipboard title="Copy Session ID" content={session.id} shortcut={{ modifiers: ["cmd"], key: "c" }} />
            <Action.CopyToClipboard title="Copy Project Directory" content={session.location.directory} />
            <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} shortcut={{ modifiers: ["cmd"], key: "r" }} />
          </ActionPanel>}
        />
      ))}
    </List>
  );
}
