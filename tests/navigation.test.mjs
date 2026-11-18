import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationLocation, reviewFileRequest, requestForView } from '../mods/annotator/navigation.js';
import { mergeChatAgents } from '../mods/annotator/chat-agents.js';
import { existingReviewTab, reviewSidebarTransition } from '../mods/annotator/review.js';

const spaces = [{ id: 's', machine: null, folder: '/main', active: true, tabs: [{ id: 'chat', active: true }, { id: 'review' }] }];
const panes = [{ pane: 'p', mod: 'chat', tab: 'chat' }, { pane: 'review-pane', mod: 'annotator', tab: 'review' }];
const focus = { space: 's', tab: 'chat', pane: 'p', terminal: null };
const agents = mergeChatAgents([], [{ address: 't6b', state: 'live', status: 'done', report: { app: 'claude-code' }, labels: { 'herdr.chat': 'p' }, cwd: '/main', foreground: { cwd: '/worktree' } }], panes, spaces);
const source = { scope: { repo: '/worktree', machine: null }, space: 's', tab: 'chat' };
const reviews = { review: { sourceTab: 'chat', space: 's', scope: source.scope } };

test('empty App check state has no source checkout', () => {
  assert.deepEqual(navigationLocation(null, null, [], [], [], {}), { scope: { repo: '', machine: null }, space: null, tab: null });
});
test('Changes follows native chat foreground worktree instead of main checkout', () => {
  assert.deepEqual(navigationLocation(null, focus, spaces, panes, agents, {}), source);
});
test('review tab retains original checkout and source chat', () => {
  assert.deepEqual(navigationLocation(null, { ...focus, tab: 'review', pane: 'review-pane' }, spaces, panes, agents, reviews), source);
});
test('explicit scope remains pinned despite focus changes', () => {
  assert.deepEqual(navigationLocation(source, { space: 'other', tab: 'other' }, [], [], [], {}), source);
});
test('same checkout reuses review tab, another source or checkout does not', () => {
  assert.deepEqual(existingReviewTab(source, spaces, panes, reviews), { tab: 'review', pane: 'review-pane' });
  assert.equal(existingReviewTab({ ...source, tab: 'other' }, spaces, panes, reviews), null);
  assert.equal(existingReviewTab({ ...source, scope: { ...source.scope, repo: '/other' } }, spaces, panes, reviews), null);
});
test('file handoff preserves target, source and comparison', () => {
  const request = reviewFileRequest('review', source.scope, 'src/file.ts', 'branch', 'main', true, 1234);
  assert.equal(request.path, '/worktree/src/file.ts');
  assert.equal(request.target_tab, 'review');
  assert.deepEqual(request.comparison, { mode: 'branch', base: 'main', explicit: true });
  assert.equal(requestForView(request, false, 'review'), false);
  assert.equal(requestForView(request, true, 'unrelated'), false);
  assert.equal(requestForView(request, true, 'review'), true);
});
test('full review hides Changes and returning restores it', () => {
  const panel = { id: 'panel', stack: 'panel-body', active: 'changes', hidden: false, changes: true };
  const registered = { review: { ...reviews.review, sourcePanel: panel } };
  const opened = reviewSidebarTransition(null, { space: 's', tab: 'review' }, registered, panel);
  assert.deepEqual(opened.actions, [{ name: 'layout.hide', args: { id: 'panel' } }]);
  const returned = reviewSidebarTransition(opened.state, { space: 's', tab: 'chat' }, registered, { ...panel, hidden: true });
  assert.deepEqual(returned.actions, [{ name: 'layout.select', args: { stack: 'panel-body', child: 'changes' } }, { name: 'layout.show', args: { id: 'panel' } }]);
});
