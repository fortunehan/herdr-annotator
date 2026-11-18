import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeChatAgents } from '../mods/annotator/chat-agents.js';
import { sessionTarget, reviewTargetReady } from '../mods/annotator/review.js';

const terminal = { address: 't6b', state: 'live', report: { app: 'claude-code' }, status: 'done', labels: { 'herdr.chat': 'chat-pane' } };
const pane = { pane: 'chat-pane', mod: 'chat', tab: 'source-tab' };
const space = { id: 'source-space', machine: null, tabs: [{ id: 'source-tab' }] };
const context = { scope: { machine: null }, space: space.id, tab: pane.tab };
const merge = (terminals = [terminal], panes = [pane], spaces = [space], visible = []) => mergeChatAgents(visible, terminals, panes, spaces);

test('native chat resolves to its original source session', () => {
  const target = sessionTarget(merge(), context, null, 't6b');
  assert.equal(target.address, 't6b');
  assert.equal(target.pane, pane.pane);
  assert.ok(reviewTargetReady(target));
});

test('another tab or space cannot receive the review', () => {
  assert.equal(sessionTarget(merge(), { ...context, tab: 'other-tab' }, null, 't6b'), null);
  assert.equal(sessionTarget(merge(), { ...context, space: 'other-space' }, null, 't6b'), null);
});

test('closed, unreported, missing and non-chat terminals stay unavailable', () => {
  assert.deepEqual(merge([{ ...terminal, state: 'exited' }]), []);
  assert.deepEqual(merge([{ ...terminal, report: null }]), []);
  assert.deepEqual(merge([terminal], []), []);
  assert.deepEqual(merge([terminal], [{ ...pane, mod: 'annotator' }]), []);
  assert.deepEqual(merge([terminal], [pane], []), []);
});

test('blocked and unknown status never become send-ready', () => {
  for (const status of ['blocked', 'unknown', null]) {
    const target = merge([{ ...terminal, status }])[0];
    assert.equal(target.status, status);
    assert.ok(!reviewTargetReady(target));
  }
});

test('visible agents are preserved without duplication', () => {
  const visible = { address: 't6b', pane: 'terminal-pane', status: 'blocked' };
  assert.deepEqual(merge([terminal], [pane], [space], [visible]), [visible]);
});

test('remote labels are qualified and cannot bind a local pane', () => {
  const remote = { ...terminal, address: 'remote/t6b' };
  assert.deepEqual(merge([remote]), []);
  const remotePane = { ...pane, pane: 'remote/chat-pane', tab: 'remote/source-tab' };
  const remoteSpace = { ...space, id: 'remote/source-space', machine: 'remote', tabs: [{ id: remotePane.tab }] };
  const result = merge([remote], [remotePane], [remoteSpace]);
  assert.equal(result[0].address, 'remote/t6b');
  assert.equal(result[0].pane, remotePane.pane);
  assert.equal(sessionTarget(result, context, null, 'remote/t6b'), null);
});
