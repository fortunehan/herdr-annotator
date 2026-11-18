import test from 'node:test';
import assert from 'node:assert/strict';
import { followTask, taskOpen, whereOf, goneLine, taskGone } from '../mods/annotator/follow.js';
import { navigationLocation } from '../mods/annotator/navigation.js';

const spaces = [{ id: 's', machine: null, folder: '/main', active: true, tabs: [{ id: 'chat', active: true }] }];
const panes = [{ pane: 'p', tab: 'chat', terminal: 't1', cwd: '/main' }];
const focus = { space: 's', tab: 'chat', pane: 'p', terminal: 't1' };
const layoutWith = active => ({ children: [{ id: 'panel', children: [{ id: 'tasks', active, children: [{ id: 'tasks-list' }, { id: 'tasks-thread' }] }] }] });
const thread = { terminal: 't9', task: 'SNUW-9', key: { folder: '/main', machine: null } };
const where = { terminal: 't9', ref: 'SNUW-9', folder: '/worktrees/snuw-9', machine: null, base: 'main', branch: 'feature/9', repo: '/main' };
const space = { scope: { repo: '/main', machine: null }, space: 's', tab: 'chat' };
const at = task => navigationLocation(null, focus, spaces, panes, [], {}, task);

test('taskOpen reads the tasks stack, wherever it is and whether hidden or not', () => {
  assert.equal(taskOpen(layoutWith('tasks-thread')), true);
  assert.equal(taskOpen(layoutWith('tasks-list')), false);
  assert.equal(taskOpen(null), false);
  assert.equal(taskOpen({ children: [{ id: 'other', active: 'tasks-thread' }] }), false);
});

test('no task open: the space as before', () => {
  assert.equal(followTask({ open: false, thread, where }), null);
  assert.equal(followTask({ open: true, thread: null, where }), null);
  assert.deepEqual(at(null), space);
});

test('no Shepherdr keys: unchanged', () => {
  const task = followTask({ open: taskOpen(null), thread: null, where: null });
  assert.equal(task, null);
  assert.deepEqual(at(task), navigationLocation(null, focus, spaces, panes, [], {}));
});

test('task open with where: its worktree, machine and base', () => {
  const location = at(followTask({ open: true, thread, where }));
  assert.deepEqual(location.scope, { repo: '/worktrees/snuw-9', machine: null });
  assert.equal(location.task.ref, 'SNUW-9');
  assert.equal(location.task.base, 'main');
  assert.equal(location.task.terminal, 't9');
  assert.equal(location.task.pending, false);
  assert.equal(location.space, 's');
});

test('remote task: the machine from where, else from its terminal', () => {
  const remote = { ...thread, terminal: 'vm/t9' };
  assert.equal(at(followTask({ open: true, thread: remote, where: { ...where, terminal: 'vm/t9', machine: 'vm' } })).scope.machine, 'vm');
  assert.equal(at(followTask({ open: true, thread: remote, where: { ...where, terminal: 'vm/t9', machine: undefined } })).scope.machine, 'vm');
});

test('where not yet published, or another task\'s: pending, never the space\'s files', () => {
  for (const stale of [null, { ...where, terminal: 't8', ref: 'SNUW-8' }, { ...where, folder: null }]) {
    const location = at(followTask({ open: true, thread, where: stale }));
    assert.equal(location.scope.repo, '', JSON.stringify(stale));
    assert.equal(location.task.pending, true);
    assert.equal(location.task.ref, 'SNUW-9');
  }
});

test('a task never started shows its list\'s folder', () => {
  const fresh = { terminal: null, task: 'SNUW-10', key: { folder: '/main', machine: null } };
  assert.equal(whereOf(fresh, where), null);
  const location = at(followTask({ open: true, thread: fresh, where: null }));
  assert.deepEqual(location.scope, { repo: '/main', machine: null });
  assert.equal(location.task.pending, false);
  assert.equal(at(followTask({ open: true, thread: fresh, where: { ...where, terminal: null, ref: 'SNUW-10', folder: '/main' } })).task.base, 'main');
});

test('worktree gone: a quiet line, recognised from the helper\'s failure', () => {
  assert.equal(goneLine('SNUW-9', null), "SNUW-9's worktree is gone");
  assert.equal(goneLine(null, null), "This task's worktree is gone");
  assert.equal(goneLine('SNUW-9', 'feature/9'), "SNUW-9's worktree is gone: its branch feature/9 against its base");
  assert.ok(taskGone('fatal: not a git repository (or any of the parent directories): .git'));
  assert.ok(taskGone('No such file or directory (os error 2)'));
  assert.ok(!taskGone("Base 'main' is not available locally; choose a local ref (no automatic fetch)"));
  assert.ok(!taskGone('Connection timed out'));
});

test('switching fast: only what the keys say now counts', () => {
  const second = { terminal: 't10', task: 'SNUW-10' };
  assert.equal(at(followTask({ open: true, thread: second, where })).task.pending, true, "the first task's where never shows for the second");
  const now = { ...where, terminal: 't10', ref: 'SNUW-10', folder: '/worktrees/snuw-10' };
  assert.equal(at(followTask({ open: true, thread: second, where: now })).scope.repo, '/worktrees/snuw-10');
});

test('a full review tab keeps its pinned checkout even with a task open', () => {
  const fixed = { scope: { repo: '/pinned', machine: null }, space: 's', tab: 'chat' };
  assert.deepEqual(navigationLocation(fixed, focus, spaces, panes, [], {}, followTask({ open: true, thread, where })), fixed);
});
