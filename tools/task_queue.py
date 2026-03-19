#!/usr/bin/env python3
"""
PolyBack Agent Task Queue
-------------------------
A lightweight file-based task queue for coordinating autonomous agent work.

Usage:
  task_queue.py add <agent> <description>
  task_queue.py list [--agent <agent>] [--status <status>]
  task_queue.py claim <task_id> <agent>
  task_queue.py done <task_id>
  task_queue.py fail <task_id> [reason]
  task_queue.py pending <agent>   # exits 0 if tasks exist, 1 if none
"""

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

QUEUE_FILE = Path(__file__).parent.parent / "agent_tasks.json"
AGENTS = {"nexus", "axiom", "forge", "lens", "harbor", "phantom"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict:
    if not QUEUE_FILE.exists():
        return {"tasks": []}
    return json.loads(QUEUE_FILE.read_text())


def _save(data: dict):
    QUEUE_FILE.write_text(json.dumps(data, indent=2))


def add_task(agent: str, description: str, priority: str = "normal") -> dict:
    if agent not in AGENTS:
        print(f"Unknown agent: {agent}. Valid: {', '.join(sorted(AGENTS))}")
        sys.exit(1)
    data = _load()
    task = {
        "id": str(uuid.uuid4())[:8],
        "agent": agent,
        "description": description,
        "priority": priority,
        "status": "pending",
        "created_at": _now(),
        "updated_at": _now(),
        "result": None,
    }
    data["tasks"].append(task)
    _save(data)
    print(f"Task {task['id']} added for {agent}: {description[:60]}")
    return task


def list_tasks(agent: str = None, status: str = None):
    data = _load()
    tasks = data["tasks"]
    if agent:
        tasks = [t for t in tasks if t["agent"] == agent]
    if status:
        tasks = [t for t in tasks if t["status"] == status]
    if not tasks:
        print("No tasks found.")
        return
    for t in tasks:
        print(f"[{t['id']}] {t['status'].upper():12} {t['agent']:8} {t['description'][:60]}")


def claim_task(task_id: str, agent: str):
    data = _load()
    for task in data["tasks"]:
        if task["id"] == task_id:
            task["status"] = "in_progress"
            task["agent"] = agent
            task["updated_at"] = _now()
            _save(data)
            print(f"Task {task_id} claimed by {agent}")
            return
    print(f"Task {task_id} not found")
    sys.exit(1)


def complete_task(task_id: str, result: str = None):
    data = _load()
    for task in data["tasks"]:
        if task["id"] == task_id:
            task["status"] = "done"
            task["updated_at"] = _now()
            if result:
                task["result"] = result
            _save(data)
            print(f"Task {task_id} marked done")
            return
    print(f"Task {task_id} not found")
    sys.exit(1)


def fail_task(task_id: str, reason: str = None):
    data = _load()
    for task in data["tasks"]:
        if task["id"] == task_id:
            task["status"] = "failed"
            task["updated_at"] = _now()
            if reason:
                task["result"] = reason
            _save(data)
            print(f"Task {task_id} marked failed")
            return
    print(f"Task {task_id} not found")
    sys.exit(1)


def pending_for_agent(agent: str) -> int:
    """Returns number of pending tasks for agent. Used by cron scripts."""
    data = _load()
    pending = [t for t in data["tasks"] if t["agent"] == agent and t["status"] == "pending"]
    for t in pending:
        print(f"[{t['id']}] {t['description'][:80]}")
    return len(pending)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)

    cmd = args[0]

    if cmd == "add" and len(args) >= 3:
        add_task(args[1], " ".join(args[2:]))
    elif cmd == "list":
        agent = args[args.index("--agent") + 1] if "--agent" in args else None
        status = args[args.index("--status") + 1] if "--status" in args else None
        list_tasks(agent, status)
    elif cmd == "claim" and len(args) == 3:
        claim_task(args[1], args[2])
    elif cmd == "done" and len(args) >= 2:
        result = " ".join(args[2:]) if len(args) > 2 else None
        complete_task(args[1], result)
    elif cmd == "fail" and len(args) >= 2:
        reason = " ".join(args[2:]) if len(args) > 2 else None
        fail_task(args[1], reason)
    elif cmd == "pending" and len(args) == 2:
        count = pending_for_agent(args[1])
        sys.exit(0 if count > 0 else 1)
    else:
        print(__doc__)
        sys.exit(1)
