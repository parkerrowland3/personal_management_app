"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import type { Session } from "@supabase/supabase-js";

import { sampleTasks } from "@/lib/sample-data";
import { DOMAIN_OPTIONS, PRIORITY_OPTIONS, STATUS_OPTIONS, type Domain, type Task, type TaskDraft, type TaskPriority, type TaskStatus } from "@/lib/types";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const EMPTY_TASK: TaskDraft = {
  title: "",
  description: "",
  domain: "personal",
  status: "today",
  priority: "medium",
  due_date: null
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  today: "Today",
  in_progress: "In Progress",
  done: "Done"
};

const domainLabels: Record<Domain, string> = {
  personal: "Personal",
  work: "Work",
  school: "School"
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High"
};

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return STATUS_OPTIONS.indexOf(left.status) - STATUS_OPTIONS.indexOf(right.status);
    }

    if (left.domain !== right.domain) {
      return DOMAIN_OPTIONS.indexOf(left.domain) - DOMAIN_OPTIONS.indexOf(right.domain);
    }

    if (left.due_date && right.due_date) {
      return left.due_date.localeCompare(right.due_date);
    }

    if (left.due_date) {
      return -1;
    }

    if (right.due_date) {
      return 1;
    }

    return left.title.localeCompare(right.title);
  });
}

export function TaskShell() {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(sampleTasks[0]?.id ?? null);
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK);
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<Domain | "all">("all");
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured());
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    isSupabaseConfigured()
      ? null
      : "Demo mode is active. Add your Supabase URL and anon key to connect live data."
  );

  const deferredSearch = useDeferredValue(search);
  const supabase = getSupabaseBrowserClient();

  const loadTasks = useCallback(
    async (userId: string) => {
      if (!supabase) {
        return;
      }

      setIsLoading(true);

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false });

      if (error) {
        setNotice(error.message);
        setIsLoading(false);
        return;
      }

      const nextTasks = sortTasks((data ?? []) as Task[]);
      setTasks(nextTasks);
      setSelectedTaskId(nextTasks[0]?.id ?? null);
      setNotice(null);
      setIsLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const client = supabase;
    let isMounted = true;

    async function bootstrap() {
      const { data: sessionData } = await client.auth.getSession();

      let tasksResult:
        | { data: Task[]; error: null }
        | {
            data: Task[] | null;
            error: { message: string } | null;
          } = { data: [], error: null };

      if (sessionData.session?.user.id) {
        const result = await client
          .from("tasks")
          .select("*")
          .eq("user_id", sessionData.session.user.id)
          .order("status", { ascending: true })
          .order("updated_at", { ascending: false });

        tasksResult = {
          data: (result.data as Task[] | null) ?? [],
          error: result.error ? { message: result.error.message } : null
        };
      }

      if (!isMounted) {
        return;
      }

      setSession(sessionData.session);

      if (tasksResult.error) {
        setNotice(tasksResult.error.message);
      } else if (tasksResult.data && tasksResult.data.length > 0) {
        const nextTasks = sortTasks(tasksResult.data as Task[]);
        setTasks(nextTasks);
        setSelectedTaskId((current) => current ?? nextTasks[0]?.id ?? null);
      } else if (sessionData.session) {
        setTasks([]);
        setSelectedTaskId(null);
      }

      setIsLoading(false);
    }

    bootstrap();

    const authSubscription = client.auth.onAuthStateChange((_event, nextSession) => {
      startTransition(() => {
        setSession(nextSession);
      });

      if (nextSession?.user.id) {
        void loadTasks(nextSession.user.id);
      } else {
        setTasks(sampleTasks);
        setSelectedTaskId(sampleTasks[0]?.id ?? null);
        setNotice("Signed out. Demo mode data is shown until you sign in again.");
      }
    });

    return () => {
      isMounted = false;
      authSubscription.data.subscription.unsubscribe();
    };
  }, [loadTasks, supabase]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  const visibleTasks = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesDomain = activeDomain === "all" || task.domain === activeDomain;
      const matchesSearch =
        !normalized ||
        task.title.toLowerCase().includes(normalized) ||
        task.description?.toLowerCase().includes(normalized);

      return matchesDomain && matchesSearch;
    });
  }, [activeDomain, deferredSearch, tasks]);

  const groupedTasks = useMemo(() => {
    return STATUS_OPTIONS.map((status) => ({
      status,
      tasks: visibleTasks.filter((task) => task.status === status)
    }));
  }, [visibleTasks]);

  const domainCounts = useMemo(() => {
    return DOMAIN_OPTIONS.map((domain) => ({
      domain,
      count: tasks.filter((task) => task.domain === domain).length
    }));
  }, [tasks]);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice("Supabase is not configured yet.");
      return;
    }

    setIsSaving(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined
      }
    });

    setNotice(
      error ? error.message : `Magic link sent to ${email}. Open the email and come back here.`
    );
    setIsSaving(false);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim()) {
      setNotice("Task title is required.");
      return;
    }

    if (!supabase || !session?.user.id) {
      const nextTask: Task = {
        ...draft,
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        description: draft.description?.trim() || null
      };
      const nextTasks = sortTasks([nextTask, ...tasks]);
      setTasks(nextTasks);
      setSelectedTaskId(nextTask.id);
      setDraft(EMPTY_TASK);
      setNotice("Task added in demo mode.");
      return;
    }

    setIsSaving(true);

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...draft,
        user_id: session.user.id,
        title: draft.title.trim(),
        description: draft.description?.trim() || null
      })
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    const nextTasks = sortTasks([data as Task, ...tasks]);
    setTasks(nextTasks);
    setSelectedTaskId(data.id);
    setDraft(EMPTY_TASK);
    setNotice("Task created.");
    setIsSaving(false);
  }

  async function updateSelectedTask(patch: Partial<TaskDraft>) {
    if (!selectedTask) {
      return;
    }

    const optimisticTask: Task = {
      ...selectedTask,
      ...patch
    };

    setTasks((current) =>
      sortTasks(current.map((task) => (task.id === selectedTask.id ? optimisticTask : task)))
    );

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      setNotice("Updated locally in demo mode.");
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        ...patch,
        description: patch.description?.trim() || null
      })
      .eq("id", selectedTask.id);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice("Task updated.");
  }

  async function deleteSelectedTask() {
    if (!selectedTask) {
      return;
    }

    const fallbackId = tasks.find((task) => task.id !== selectedTask.id)?.id ?? null;
    setTasks((current) => current.filter((task) => task.id !== selectedTask.id));
    setSelectedTaskId(fallbackId);

    if (!supabase || !session?.user.id || selectedTask.id.startsWith("sample-")) {
      setNotice("Removed locally in demo mode.");
      return;
    }

    const { error } = await supabase.from("tasks").delete().eq("id", selectedTask.id);

    if (error) {
      setNotice(error.message);
      await loadTasks(session.user.id);
      return;
    }

    setNotice("Task deleted.");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <p className="eyebrow">Personal OS</p>
          <h1>Focus Desk</h1>
          <p className="sidebar__copy">
            A calm workspace for personal life, work, and school. Structured like a lightweight
            Notion dashboard.
          </p>
        </div>

        <section className="panel">
          <div className="panel__header">
            <h2>Spaces</h2>
          </div>
          <button
            className={`filter-chip ${activeDomain === "all" ? "filter-chip--active" : ""}`}
            onClick={() => setActiveDomain("all")}
            type="button"
          >
            All tasks
            <span>{tasks.length}</span>
          </button>
          {domainCounts.map(({ domain, count }) => (
            <button
              className={`filter-chip ${activeDomain === domain ? "filter-chip--active" : ""}`}
              key={domain}
              onClick={() => setActiveDomain(domain)}
              type="button"
            >
              {domainLabels[domain]}
              <span>{count}</span>
            </button>
          ))}
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2>{supabase ? "Account" : "Demo mode"}</h2>
          </div>
          {supabase ? (
            session ? (
              <div className="auth-state">
                <p>{session.user.email}</p>
                <button className="secondary-button" onClick={signOut} type="button">
                  Sign out
                </button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={sendMagicLink}>
                <label>
                  Email
                  <input
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                  />
                </label>
                <button className="primary-button" disabled={isSaving || !email} type="submit">
                  {isSaving ? "Sending..." : "Send magic link"}
                </button>
              </form>
            )
          ) : (
            <p className="muted">Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to go live.</p>
          )}
        </section>

        <section className="panel panel--soft">
          <div className="panel__header">
            <h2>Workflow</h2>
          </div>
          <p className="muted">
            Capture ideas in backlog, pull real work into today, and close loops in done.
          </p>
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace__header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>Daily command center</h2>
          </div>

          <div className="workspace__actions">
            <input
              className="search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
              value={search}
            />
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        <section className="composer panel">
          <div className="panel__header">
            <h2>Quick capture</h2>
          </div>
          <form className="composer__form" onSubmit={createTask}>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Write a task title"
              value={draft.title}
            />
            <textarea
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Add context, notes, or next actions"
              rows={3}
              value={draft.description ?? ""}
            />
            <div className="composer__grid">
              <label>
                Space
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      domain: event.target.value as Domain
                    }))
                  }
                  value={draft.domain}
                >
                  {DOMAIN_OPTIONS.map((domain) => (
                    <option key={domain} value={domain}>
                      {domainLabels[domain]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as TaskStatus
                    }))
                  }
                  value={draft.status}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      priority: event.target.value as TaskPriority
                    }))
                  }
                  value={draft.priority}
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due date
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      due_date: event.target.value || null
                    }))
                  }
                  type="date"
                  value={draft.due_date ?? ""}
                />
              </label>
            </div>
            <button className="primary-button" disabled={isSaving || isLoading} type="submit">
              {isSaving ? "Saving..." : "Add task"}
            </button>
          </form>
        </section>

        <section className="board">
          {groupedTasks.map(({ status, tasks: statusTasks }) => (
            <article className="board-column panel" key={status}>
              <div className="panel__header">
                <h2>{statusLabels[status]}</h2>
                <span className="count-pill">{statusTasks.length}</span>
              </div>
              <div className="task-list">
                {statusTasks.map((task) => (
                  <button
                    className={`task-card ${selectedTaskId === task.id ? "task-card--selected" : ""}`}
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    type="button"
                  >
                    <div className="task-card__meta">
                      <span className={`domain-pill domain-pill--${task.domain}`}>
                        {domainLabels[task.domain]}
                      </span>
                      <span className={`priority-pill priority-pill--${task.priority}`}>
                        {priorityLabels[task.priority]}
                      </span>
                    </div>
                    <h3>{task.title}</h3>
                    {task.description ? <p>{task.description}</p> : null}
                    <div className="task-card__footer">
                      <span>{statusLabels[task.status]}</span>
                      <span>{task.due_date ? formatDate(task.due_date) : "No deadline"}</span>
                    </div>
                  </button>
                ))}
                {!statusTasks.length ? (
                  <div className="empty-state">
                    <p>No tasks here yet.</p>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </section>

      <aside className="detail panel">
        <div className="panel__header">
          <h2>Task detail</h2>
        </div>
        {selectedTask ? (
          <div className="detail__content">
            <label>
              Title
              <input
                onChange={(event) => void updateSelectedTask({ title: event.target.value })}
                value={selectedTask.title}
              />
            </label>
            <label>
              Notes
              <textarea
                onChange={(event) => void updateSelectedTask({ description: event.target.value })}
                rows={8}
                value={selectedTask.description ?? ""}
              />
            </label>
            <label>
              Space
              <select
                onChange={(event) =>
                  void updateSelectedTask({ domain: event.target.value as Domain })
                }
                value={selectedTask.domain}
              >
                {DOMAIN_OPTIONS.map((domain) => (
                  <option key={domain} value={domain}>
                    {domainLabels[domain]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                onChange={(event) =>
                  void updateSelectedTask({ status: event.target.value as TaskStatus })
                }
                value={selectedTask.status}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                onChange={(event) =>
                  void updateSelectedTask({ priority: event.target.value as TaskPriority })
                }
                value={selectedTask.priority}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabels[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                onChange={(event) => void updateSelectedTask({ due_date: event.target.value || null })}
                type="date"
                value={selectedTask.due_date ?? ""}
              />
            </label>
            <button className="danger-button" onClick={() => void deleteSelectedTask()} type="button">
              Delete task
            </button>
          </div>
        ) : (
          <div className="empty-state empty-state--detail">
            <p>Select a task to edit it.</p>
          </div>
        )}
      </aside>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}
