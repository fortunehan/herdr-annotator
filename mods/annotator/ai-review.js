/**
 * Producer side of Shepherdr's "Changes Review launch bridge v1". It only asks the
 * existing review dialog to open for the captured Changes target; the person still
 * presses Run there. Model, effort, depth, session and report behavior stay in Shepherdr.
 * This module imports nothing, so it never depends on another mod's installed code.
 */
export const REVIEW_BRIDGE = "changes.review.bridge";
export const CONFIRM_TIMEOUT = 15000;

const UNAVAILABLE = "AI Review is unavailable. Update/enable Shepherdr and try again.";
const OUTDATED = "AI Review needs a newer Shepherdr or Annotator. Update both and try again.";
const COMMAND = /^[A-Za-z0-9_-]+\.review-open:$/;
const KEY = /^[A-Za-z0-9._-]+$/;
const OID = /^[a-f0-9]{40,64}$/;

/** Validates the capability published by Shepherdr's host; never guesses another transport. */
export function reviewBridge(cap, now) {
  if (!cap || typeof cap !== "object" || Array.isArray(cap)) return { ok: false, reason: UNAVAILABLE };
  if (cap.version !== 1) return { ok: false, reason: Number.isInteger(cap.version) && cap.version > 1 ? OUTDATED : UNAVAILABLE };
  if (!Number.isFinite(cap.expires) || cap.expires <= now) return { ok: false, reason: UNAVAILABLE };
  if (typeof cap.instance !== "string" || !cap.instance || typeof cap.command !== "string" || !COMMAND.test(cap.command)
    || typeof cap.results !== "string" || !KEY.test(cap.results)) return { ok: false, reason: OUTDATED };
  return { ok: true, cap };
}

const oid = value => value === null || (typeof value === "string" && OID.test(value));
const fail = error => ({ ok: false, error });

/**
 * Builds the launch request from state captured synchronously at click time. Every
 * failure is a readable reason: nothing falls back to the focused checkout, an
 * inferred base, or another source session.
 *
 * @param {object} input
 * @param {{ instance: string }} input.cap A validated capability.
 * @param {{ space: string|null, tab: string|null, scope: { repo: string, machine?: string|null } }} input.current The view's own location.
 * @param {object|null} input.snapshot The loaded snapshot, never an in-flight one.
 * @param {{ full?: boolean, busy?: boolean, snapshotError?: unknown, context?: string, loadedContext?: string, mode?: string, base?: string|null }} input.view
 * @param {{ address: string }|null} input.source The source session bound to this view.
 * @param {{ address: string, foreground?: { pid?: number } }|null} input.terminal The source's terminal.
 */
export function captureReview({ cap, now, id, current, snapshot, view, source, terminal }) {
  if (view.full) return fail("AI Review is only available in the Changes sidebar.");
  if (view.snapshotError) return fail("Refresh the changes before starting AI Review.");
  if (view.busy || !snapshot || view.context !== view.loadedContext) return fail("Wait for the changes to finish loading, then try AI Review again.");
  const scope = snapshot.scope;
  if (!scope?.repo || !current?.scope?.repo || !current.space || !current.tab) return fail("Select a checkout in a tab before starting AI Review.");
  const machine = scope.machine ?? null;
  if (scope.repo !== current.scope.repo || machine !== (current.scope.machine ?? null)) return fail("The loaded changes belong to a different checkout. Refresh and try again.");
  if (machine !== null) return fail("AI Review supports local checkouts only.");
  if (!scope.repo.startsWith("/")) return fail("AI Review needs an absolute checkout path.");
  const comparison = scope.comparison ?? { mode: "uncommitted", base: null };
  if (comparison.mode !== "uncommitted" && comparison.mode !== "branch") return fail("AI Review supports Uncommitted and Branch comparisons. Choose one of them.");
  if (comparison.mode !== view.mode) return fail("The comparison changed. Refresh and try again.");
  if (comparison.mode === "branch") {
    if (typeof comparison.base !== "string" || !comparison.base || comparison.base.startsWith("-")) return fail("Choose a base branch for the Branch comparison first.");
    if (view.base !== comparison.base) return fail("The base branch changed. Refresh and try again.");
  }
  if (!oid(snapshot.head) || !oid(snapshot.baseline)) return fail("Refresh the changes so AI Review can pin their commits.");
  if (!source?.address) return fail("Focus the agent chat you want to review in this tab so AI Review knows its source.");
  const pid = terminal?.address === source.address ? terminal.foreground?.pid : null;
  if (!Number.isSafeInteger(pid) || pid <= 0) return fail("The source chat's process is not available. Wait for its agent to start and try again.");
  return { ok: true, request: { version: 1, id, bridge: cap.instance, at: now, target: {
    cwd: scope.repo, on: null, workspace: current.space, tab: current.tab,
    comparison: { mode: comparison.mode, base: comparison.mode === "branch" ? comparison.base : null },
    head: snapshot.head, baseline: snapshot.baseline, source: { address: source.address, pid } } } };
}

const defaultToken = () => `annotator-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Owns the click latch and the correlated result. A pending request is never sent
 * twice: duplicate clicks do nothing, and an unconfirmed request is reported, not repeated.
 */
export class AiReviewLauncher {
  constructor({ shared, run, now = Date.now, token = defaultToken }) {
    Object.assign(this, { shared, run, now, token });
    this.pending = null; this.message = null;
  }

  /** The capability as it stands now. */
  bridge() { return reviewBridge(this.shared(REVIEW_BRIDGE), this.now()); }

  /** @returns {boolean} Whether a request was submitted. Failures are in `message`. */
  start(input) {
    if (this.pending) return false;
    this.message = null;
    const bridge = reviewBridge(this.shared(REVIEW_BRIDGE), this.now());
    if (!bridge.ok) return this.reject(bridge.reason);
    const at = this.now(), id = this.token();
    const made = captureReview({ ...input, cap: bridge.cap, now: at, id });
    if (!made.ok) return this.reject(made.error);
    this.pending = { id, at, results: bridge.cap.results };
    try { this.run(bridge.cap.command + encodeURIComponent(JSON.stringify(made.request))); }
    catch (error) { this.pending = null; return this.reject(`AI Review could not reach Shepherdr: ${error?.message ?? error}`); }
    this.message = { tone: "info", text: "Opening AI Review… Nothing runs until you press Run in the dialog." };
    return true;
  }

  /** Reads the correlated result. @returns {boolean} Whether the visible state changed. */
  poll() {
    const pending = this.pending;
    if (!pending) return false;
    const list = this.shared(pending.results);
    const result = Array.isArray(list) ? list.find(entry => entry?.id === pending.id) : null;
    if (result?.status === "opened") { this.pending = null; this.message = null; return true; }
    if (result?.status === "error") {
      this.pending = null;
      this.message = { tone: "error", text: typeof result.error === "string" && result.error ? result.error : "AI Review could not open its dialog." };
      return true;
    }
    if (this.now() - pending.at > CONFIRM_TIMEOUT) {
      this.pending = null;
      this.message = { tone: "error", text: "AI Review did not confirm opening. Check the open dialog before trying again." };
      return true;
    }
    return false;
  }

  dismiss() { if (!this.pending) this.message = null; }

  reject(text) { this.message = { tone: "error", text }; return false; }
}
