import test from "node:test";
import assert from "node:assert/strict";
import { AiReviewLauncher, captureReview, reviewBridge, REVIEW_BRIDGE, CONFIRM_TIMEOUT } from "../mods/annotator/ai-review.js";

const HEAD = "a".repeat(40), BASE = "b".repeat(40);
const cap = (extra = {}) => ({ version: 1, instance: "inst-1", expires: 20000, command: "tabs-tasks.review-open:", results: "changes.review.launch-results", ...extra });

function input(over = {}) {
  const { scope, snapshot, view, ...rest } = over;
  return {
    current: { space: "space1", tab: "tab1", scope: { repo: "/work/tree", machine: null } },
    snapshot: snapshot === null ? null : { scope: { repo: "/work/tree", machine: null, ...scope }, head: HEAD, baseline: HEAD, ...snapshot },
    view: { full: false, busy: false, snapshotError: null, context: "k", loadedContext: "k", mode: "uncommitted", base: null, ...view },
    source: { address: "term-7", space: "space1", tab: "tab1" },
    terminal: { address: "term-7", foreground: { pid: 4242 } },
    ...rest,
  };
}

function launcher({ now = 10000, values = { [REVIEW_BRIDGE]: cap() }, failRun = false } = {}) {
  const state = { now, values, commands: [], ids: 0 };
  const l = new AiReviewLauncher({ shared: key => state.values[key] ?? null, now: () => state.now,
    token: () => `id-${++state.ids}`,
    run: command => { state.commands.push(command); if (failRun) throw new Error("command refused"); } });
  return { l, state, payload: () => JSON.parse(decodeURIComponent(state.commands.at(-1).split(":").slice(1).join(":"))) };
}

test("uncommitted target is captured exactly with source pid and local workspace", () => {
  const { l, state, payload } = launcher();
  assert.equal(l.start(input()), true);
  assert.equal(state.commands.length, 1);
  assert.ok(state.commands[0].startsWith("tabs-tasks.review-open:"));
  assert.deepEqual(payload(), { version: 1, id: "id-1", bridge: "inst-1", at: 10000, target: {
    cwd: "/work/tree", on: null, workspace: "space1", tab: "tab1", comparison: { mode: "uncommitted", base: null },
    head: HEAD, baseline: HEAD, source: { address: "term-7", pid: 4242 } } });
});

test("branch target keeps the loaded snapshot's resolved base, not an empty ref input", () => {
  const { l, payload } = launcher();
  l.start(input({ scope: { repo: "/work/tree", comparison: { mode: "branch", base: "origin/develop" } },
    snapshot: { baseline: BASE }, view: { mode: "branch", base: "origin/develop" } }));
  assert.deepEqual(payload().target.comparison, { mode: "branch", base: "origin/develop" });
  assert.equal(payload().target.baseline, BASE);
  assert.equal(payload().target.head, HEAD);
});

test("followed task checkout is sent as is, never the main repository", () => {
  const { l, payload } = launcher();
  l.start(input({ scope: { repo: "/tasks/wt-3" }, current: { space: "space1", tab: "tab1", scope: { repo: "/tasks/wt-3", machine: null } } }));
  assert.equal(payload().target.cwd, "/tasks/wt-3");
});

test("unborn checkout has null head and baseline", () => {
  const { l, payload } = launcher();
  l.start(input({ snapshot: { head: null, baseline: null } }));
  assert.equal(payload().target.head, null); assert.equal(payload().target.baseline, null);
});

const refusals = [
  ["last commit comparison", { scope: { repo: "/work/tree", comparison: { mode: "last_commit", base: null } }, view: { mode: "last_commit" } }, /Uncommitted and Branch/],
  ["branch without a base", { scope: { repo: "/work/tree", comparison: { mode: "branch", base: null } }, view: { mode: "branch" } }, /base branch/],
  ["option-like base", { scope: { repo: "/work/tree", comparison: { mode: "branch", base: "--force" } }, view: { mode: "branch", base: "--force" } }, /base branch/],
  ["view comparison drifted from the snapshot", { view: { mode: "branch", base: "origin/main" } }, /comparison changed/],
  ["view base drifted from the snapshot", { scope: { repo: "/work/tree", comparison: { mode: "branch", base: "origin/develop" } }, view: { mode: "branch", base: "origin/main" } }, /base branch changed/],
  ["remote machine", { scope: { repo: "/work/tree", machine: "box" }, current: { space: "space1", tab: "tab1", scope: { repo: "/work/tree", machine: "box" } } }, /local checkouts only/],
  ["snapshot for another checkout", { current: { space: "space1", tab: "tab1", scope: { repo: "/other", machine: null } } }, /different checkout/],
  ["no workspace", { current: { space: null, tab: "tab1", scope: { repo: "/work/tree", machine: null } } }, /Select a checkout/],
  ["no tab", { current: { space: "space1", tab: null, scope: { repo: "/work/tree", machine: null } } }, /Select a checkout/],
  ["no snapshot", { snapshot: null }, /finish loading/],
  ["busy view", { view: { busy: true } }, /finish loading/],
  ["stale context", { view: { loadedContext: "old" } }, /finish loading/],
  ["snapshot error", { view: { snapshotError: { kind: "error" } } }, /Refresh/],
  ["missing head", { snapshot: { head: undefined } }, /pin their commits/],
  ["malformed baseline", { snapshot: { baseline: "HEAD" } }, /pin their commits/],
  ["no source session", { source: null }, /Focus the agent chat/],
  ["no source process", { terminal: null }, /source chat's process/],
  ["wrong terminal", { terminal: { address: "term-9", foreground: { pid: 5 } } }, /source chat's process/],
  ["invalid pid", { terminal: { address: "term-7", foreground: { pid: 0 } } }, /source chat's process/],
  ["full presentation", { view: { full: true } }, /sidebar/],
];
for (const [name, over, pattern] of refusals) test(`refuses without submitting: ${name}`, () => {
  const { l, state } = launcher();
  assert.equal(l.start(input(over)), false);
  assert.match(l.message.text, pattern); assert.equal(l.message.tone, "error");
  assert.equal(state.commands.length, 0); assert.equal(l.pending, null);
});

test("an unfinished or absent source is never replaced by another session", () => {
  const made = captureReview({ ...input({ source: null }), cap: cap(), now: 1, id: "x" });
  assert.equal(made.ok, false);
});

for (const [name, value, pattern] of [
  ["absent bridge", null, /unavailable.*Shepherdr/],
  ["expired bridge", cap({ expires: 10000 }), /unavailable/],
  ["unknown future version", cap({ version: 2 }), /newer Shepherdr or Annotator/],
  ["non-object", "yes", /unavailable/],
  ["foreign command", cap({ command: "other-mod.steal:" }), /newer Shepherdr or Annotator/],
  ["unsafe results key", cap({ results: "a b" }), /newer Shepherdr or Annotator/],
  ["missing instance", cap({ instance: "" }), /newer Shepherdr or Annotator/],
]) test(`bridge unavailable: ${name}`, () => {
  const { l, state } = launcher({ values: { [REVIEW_BRIDGE]: value } });
  assert.equal(l.start(input()), false);
  assert.match(l.message.text, pattern);
  assert.equal(state.commands.length, 0);
  assert.equal(reviewBridge(value, 10000).ok, false);
});

test("the capability is read again on every click", () => {
  const { l, state } = launcher({ values: {} });
  assert.equal(l.start(input()), false);
  state.values[REVIEW_BRIDGE] = cap();
  assert.equal(l.start(input()), true);
  assert.equal(l.message.tone, "info");
});

test("duplicate clicks while pending send exactly one request", () => {
  const { l, state } = launcher();
  assert.equal(l.start(input()), true);
  assert.equal(l.start(input()), false); assert.equal(l.start(input()), false);
  assert.equal(state.commands.length, 1);
  assert.equal(l.message.tone, "info");
});

test("opened result releases the latch and a new click gets a new id", () => {
  const { l, state, payload } = launcher();
  l.start(input());
  assert.equal(l.poll(), false); assert.ok(l.pending);
  state.values["changes.review.launch-results"] = [{ id: "someone-else", status: "opened", error: null, overlay: "o", at: 1 }];
  assert.equal(l.poll(), false);
  state.values["changes.review.launch-results"].push({ id: "id-1", status: "opened", error: null, overlay: "o1", at: 2 });
  assert.equal(l.poll(), true);
  assert.equal(l.pending, null); assert.equal(l.message, null);
  l.start(input());
  assert.equal(payload().id, "id-2"); assert.equal(state.commands.length, 2);
});

test("error result shows its reason, releases the latch and never retries", () => {
  const { l, state } = launcher();
  l.start(input());
  state.values["changes.review.launch-results"] = [{ id: "id-1", status: "error", error: "Review dialog is already opening; try again", overlay: null, at: 2 }];
  assert.equal(l.poll(), true);
  assert.equal(l.pending, null);
  assert.deepEqual(l.message, { tone: "error", text: "Review dialog is already opening; try again" });
  assert.equal(state.commands.length, 1);
});

test("error result without a reason still explains the failure", () => {
  const { l, state } = launcher();
  l.start(input());
  state.values["changes.review.launch-results"] = [{ id: "id-1", status: "error", error: null, overlay: null, at: 2 }];
  l.poll();
  assert.match(l.message.text, /could not open/);
});

test("no confirmation after fifteen seconds is reported once and not repeated", () => {
  const { l, state } = launcher();
  l.start(input());
  state.now += CONFIRM_TIMEOUT; assert.equal(l.poll(), false);
  state.now += 1; assert.equal(l.poll(), true);
  assert.match(l.message.text, /did not confirm opening/);
  assert.equal(l.pending, null); assert.equal(state.commands.length, 1);
});

test("a command transport failure is visible and does not leave the latch set", () => {
  const { l, state } = launcher({ failRun: true });
  assert.equal(l.start(input()), false);
  assert.match(l.message.text, /could not reach Shepherdr: command refused/);
  assert.equal(l.pending, null); assert.equal(state.commands.length, 1);
});

test("dismiss clears a finished message but never a pending notice", () => {
  const { l, state } = launcher();
  l.start(input()); l.dismiss(); assert.equal(l.message.tone, "info");
  state.values["changes.review.launch-results"] = [{ id: "id-1", status: "error", error: "stale target", overlay: null, at: 2 }];
  l.poll(); l.dismiss(); assert.equal(l.message, null);
});

test("request carries only documented fields and no model or delivery settings", () => {
  const { l, payload } = launcher();
  l.start(input());
  assert.deepEqual(Object.keys(payload()), ["version", "id", "bridge", "at", "target"]);
  assert.deepEqual(Object.keys(payload().target), ["cwd", "on", "workspace", "tab", "comparison", "head", "baseline", "source"]);
});
