import { reviewLocation } from "./review.js";

/**
 * Keep Changes on the source checkout when its native chat or review tab has focus, and on the task
 * open in Shepherdr's Tasks panel (see follow.js) while there is one. task: followTask()'s result or null.
 */
export function navigationLocation(fixed, focus, spaceList, paneList, agentList, reviews, task = null) {
  if (fixed?.scope) return reviewLocation(fixed);
  const review = reviews[focus?.tab];
  if (review && focus && review.space === focus.space && review.scope
      && paneList.some(pane => pane.tab === focus.tab && pane.mod === "annotator")) {
    return { scope: { repo: review.scope.repo, machine: review.scope.machine ?? null }, space: review.space, tab: review.sourceTab };
  }
  const space = spaceLocation(focus, spaceList, paneList, agentList);
  if (!task) return space;
  const { ref, terminal, base, branch, repo, pending } = task;
  return { scope: { repo: task.cwd ?? "", machine: task.on ?? null }, space: space.space, tab: space.tab,
    task: { ref, terminal, base, branch, repo, pending } };
}

function spaceLocation(focus, spaceList, paneList, agentList) {
  const space = spaceList.find(space => space.id === focus?.space) ?? spaceList.find(space => space.active);
  const tab = focus?.tab ?? space?.tabs.find(tab => tab.active)?.id;
  const candidates = agentList.filter(agent => agent.space === space?.id && agent.tab === tab);
  const source = candidates.find(agent => agent.pane === focus?.pane || agent.address === focus?.terminal)
    ?? (candidates.length === 1 ? candidates[0] : null);
  const cwd = source?.cwd ?? paneList.find(pane => pane.pane === source?.pane)?.cwd;
  if (cwd) return { scope: { repo: cwd, machine: space?.machine ?? null }, space: space.id, tab };
  return reviewLocation(null, focus, spaceList, paneList, agentList);
}

export function reviewFileRequest(tab, scope, file, mode, base, baseExplicit, now = Date.now()) {
  return {
    id: `review-file-${now}-${Math.random().toString(36).slice(2)}`, at: now,
    target_tab: tab, path: `${scope.repo.replace(/\/$/, "")}/${file}`,
    on: scope.machine ?? null, comparison: { mode, base, explicit: baseExplicit },
  };
}

export function requestForView(request, full, viewTab) {
  return !request?.target_tab || (full && request.target_tab === viewTab);
}
