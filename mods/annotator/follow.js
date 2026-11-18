// Which checkout Changes shows while Shepherdr's Tasks panel has a task open. Mirrors Shepherdr's
// core/changes-follow.js (target, taskOpen, whereOf, goneLine), which my-changes uses, so both panels
// agree. Shepherdr's shared keys are only read: "tasks.thread" names the open task and
// "tasks.thread.where" its worktree, machine, base and branch. Without Shepherdr none of them exist
// and nothing here changes what Changes shows. Decided from what the keys say now, never a queue.

/** Whether the layout's "tasks" stack shows a task ("tasks-thread"), hidden panel or not. */
export function taskOpen(tree) {
  const find = node => {
    if (!node || typeof node !== "object") return null;
    if (node.id === "tasks") return node;
    for (const child of node.children ?? []) { const hit = find(child); if (hit) return hit; }
    return null;
  };
  return find(tree)?.active === "tasks-thread";
}

const machineOf = terminal => typeof terminal === "string" && terminal.includes("/") ? terminal.split("/")[0] : null;

/** The "tasks.thread.where" that belongs to this thread: the same terminal, or for one never started the same ref. */
export function whereOf(thread, where) {
  if (!thread || !where) return null;
  const terminal = thread.terminal ?? null;
  if ((where.terminal ?? null) !== terminal) return null;
  if (terminal === null && (!thread.task || where.ref !== thread.task)) return null;
  return where;
}

/**
 * The open task to follow, or null for the space. cwd: its worktree (null while pending), on: its machine,
 * base: the task's own base branch, branch/repo: for a worktree that is gone, pending: its place isn't published yet.
 */
export function followTask({ open, thread, where }) {
  if (!open || !thread) return null;
  const w = whereOf(thread, where), terminal = thread.terminal ?? null;
  const ref = w?.ref ?? thread.task ?? null;
  if (w) {
    return { ref, terminal, cwd: w.folder ?? null, on: w.machine ?? machineOf(terminal), base: w.base ?? null,
      branch: w.branch ?? null, repo: w.repo ?? null, pending: !w.folder };
  }
  const none = { base: null, branch: null, repo: null };
  if (!terminal && thread.key?.folder) return { ref, terminal, cwd: thread.key.folder, on: thread.key.machine ?? null, ...none, pending: false };
  return { ref, terminal, cwd: null, on: machineOf(terminal), ...none, pending: true };
}

/** The quiet line for a task whose folder isn't a Git checkout any more. */
export function goneLine(ref, branch) {
  const whose = ref ? `${ref}'s` : "This task's";
  return branch ? `${whose} worktree is gone: its branch ${branch} against its base` : `${whose} worktree is gone`;
}

/** Whether a snapshot failure for a followed task means its worktree folder is no longer a checkout. */
export function taskGone(error) {
  return /not a git repository|no such file or directory|cannot change to|not a directory|os error 2\b/i.test(String(error));
}
