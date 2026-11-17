#!/usr/bin/env python3
"""Describe the sidebar and full presentations in Herdr's hidden native check.

Copies the mod to a temporary folder, injects a fixed local checkout and a loaded
snapshot, and runs `herdr-app check --print-spec`. No terminal, agent, Git read,
Shepherdr command or review is started; the spec is a description, not a painted frame.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--spec", action="store_true", help="Also print the described sidebar header and message rows")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
snapshot = {
    "snapshot": {
        "scope": {"repo": "/fixture/checkout", "machine": None}, "branch": "feature/fixture", "head": "a" * 40, "baseline": "a" * 40,
        "revision": "r1", "limited": False, "bases": [], "merge_base": None, "view": {},
        "files": [{"path": "src/lib.rs", "status": " M", "added": 3, "removed": 1, "loaded": True, "truncated": False,
                   "rows": [{"kind": "add", "old": None, "new": 1, "text": "fixture"}]}],
    },
    "comments": [],
}
states = {
    "sidebar": "",
    "sidebar-pending": "this.aiReview.pending = { id: 'x', at: Date.now(), results: 'r' };",
    "sidebar-error": "this.aiReview.message = { tone: 'error', text: 'AI Review is unavailable. Update/enable Shepherdr and try again.' };",
    "full": "this.full = true;",
}
for name, extra in states.items():
    with tempfile.TemporaryDirectory(prefix=f"annotator-ai-{name}-") as temp:
        target = Path(temp)
        for path in (root / "mods/annotator").glob("*.js"):
            shutil.copy2(path, target / path.name)
        shutil.copy2(root / "mods/annotator/mod.json", target / "mod.json")
        script = (root / "mods/annotator/main.js").read_text()
        script = script.replace("function location() {", 'function location() { return {scope:{repo:"/fixture/checkout",machine:null},space:"s1",tab:"t1"};', 1)
        script = script.replace("if (this.updates?.running) return this.updateScreen();", "", 1)
        script = script.replace("    this.refresh(cx);\n    cx.timer.every(15000",
                                "    this.context = contextKey(); this.data = " + json.dumps(snapshot) + "; this.open = 'src/lib.rs'; " + extra + "\n    cx.timer.every(15000", 1)
        (target / "main.js").write_text(script)
        result = subprocess.run(["herdr-app", "check", str(target), "--print-spec"], capture_output=True, text=True)
        spec = result.stdout
        ids = re.findall(r':id\[Str\("(ai-review[^"]*|open-full-review)"\)\]', spec)
        texts = [text for text in ("AI Review", "Opening…", "Update/enable Shepherdr") if text in spec]
        print(f"{name}: exit {result.returncode}; ids={ids}; texts={texts}")
        if args.spec and name != "full":
            lines = spec.splitlines()
            start = next(n for n, line in enumerate(lines) if "open-full-review" in line)
            print("\n".join(lines[max(0, start - 3):start + 14]))
        if result.returncode:
            print(result.stdout[-800:], result.stderr[-800:])
            raise SystemExit(result.returncode)
