#!/usr/bin/env bash
# PolyBack Agent Runner
# ---------------------
# Called by cron for each agent. Checks the task queue for pending work,
# wakes the agent via OpenClaw CLI, and passes the task as a prompt.
#
# Usage: agent_runner.sh <agent_id>
# Example crontab (add with: crontab -e):
#
#   */10 * * * * /home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh lens
#   */10 * * * * /home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh axiom
#   */10 * * * * /home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh forge
#   */10 * * * * /home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh harbor
#   */5  * * * * /home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh nexus

set -euo pipefail

AGENT="${1:-}"
if [[ -z "$AGENT" ]]; then
    echo "Usage: agent_runner.sh <agent_id>"
    exit 1
fi

QUEUE_SCRIPT="/home/robert-nichols/quant_project/Polymarket/tools/task_queue.py"
LOG_DIR="/home/robert-nichols/quant_project/Polymarket/logs/agents"
LOG_FILE="$LOG_DIR/${AGENT}_runner.log"
OPENCLAW="/home/robert-nichols/.npm-global/bin/openclaw"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$AGENT] $*" | tee -a "$LOG_FILE"
}

log "Runner started"

# Check for pending tasks
PENDING_OUTPUT=$(python3 "$QUEUE_SCRIPT" pending "$AGENT" 2>&1)
PENDING_EXIT=$?

if [[ $PENDING_EXIT -ne 0 ]]; then
    log "No pending tasks — idle"
    exit 0
fi

log "Pending tasks found:"
log "$PENDING_OUTPUT"

# Extract first task ID and description
TASK_ID=$(echo "$PENDING_OUTPUT" | head -1 | grep -oP '^\[\K[^\]]+')
TASK_DESC=$(echo "$PENDING_OUTPUT" | head -1 | sed 's/^\[[^]]*\] //')

if [[ -z "$TASK_ID" ]]; then
    log "Could not parse task ID — skipping"
    exit 1
fi

log "Claiming task $TASK_ID: $TASK_DESC"
python3 "$QUEUE_SCRIPT" claim "$TASK_ID" "$AGENT"

# Build prompt for the agent
PROMPT="[TASK:$TASK_ID] $TASK_DESC

When complete, run: python3 $QUEUE_SCRIPT done $TASK_ID <brief result summary>
If failed, run: python3 $QUEUE_SCRIPT fail $TASK_ID <reason>"

log "Waking agent via OpenClaw CLI..."

# Invoke OpenClaw agent with task prompt
if "$OPENCLAW" agent --agent "$AGENT" --message "$PROMPT" >> "$LOG_FILE" 2>&1; then
    log "Agent invocation complete for task $TASK_ID"
else
    log "Agent invocation failed for task $TASK_ID — marking failed"
    python3 "$QUEUE_SCRIPT" fail "$TASK_ID" "runner invocation error"
fi

log "Runner done"
