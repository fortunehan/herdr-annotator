/** Include live agents represented by Shepherdr chat panes while preserving source-tab checks. */
export function mergeChatAgents(visibleAgents, terminalList, paneList, spaceList) {
  const result = [...visibleAgents];
  const known = new Set(visibleAgents.map(agent => agent.address));
  const chats = new Map(paneList.filter(pane => pane.mod === "chat").map(pane => [pane.pane, pane]));
  for (const terminal of terminalList) {
    if (terminal.state !== "live" || !terminal.report?.app || known.has(terminal.address)) continue;
    const label = terminal.labels?.["herdr.chat"];
    if (!label) continue;
    const machine = terminal.address.includes("/") ? terminal.address.split("/")[0] : null;
    const paneId = machine && !label.includes("/") ? `${machine}/${label}` : label;
    const pane = chats.get(paneId);
    if (!pane) continue;
    const space = spaceList.find(space => (space.machine ?? null) === machine && space.tabs.some(tab => tab.id === pane.tab));
    const tab = space?.tabs.find(tab => tab.id === pane.tab);
    if (!space || !tab) continue;
    result.push({
      address: terminal.address, pane: pane.pane, space: space.id, space_name: space.name,
      tab: tab.id, tab_index: tab.index, tab_name: tab.name,
      status: terminal.status, app: terminal.report.app, program: terminal.program,
      cwd: terminal.foreground?.cwd ?? terminal.cwd ?? null,
      title: terminal.title ?? "", seq: terminal.turn ?? 0, focused: pane.focused,
    });
    known.add(terminal.address);
  }
  return result;
}
