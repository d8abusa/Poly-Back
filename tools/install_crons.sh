#!/usr/bin/env bash
# Install PolyBack agent runner cron jobs
# Run once: bash tools/install_crons.sh

RUNNER="/home/robert-nichols/quant_project/Polymarket/tools/agent_runner.sh"
chmod +x "$RUNNER"

# Remove any existing polyback agent crons then re-add
(crontab -l 2>/dev/null | grep -v "agent_runner.sh") | crontab -

(crontab -l 2>/dev/null; cat <<EOF
# PolyBack Agent Runners
*/5  * * * * $RUNNER nexus  >> /home/robert-nichols/quant_project/Polymarket/logs/agents/nexus_cron.log 2>&1
*/10 * * * * $RUNNER lens   >> /home/robert-nichols/quant_project/Polymarket/logs/agents/lens_cron.log 2>&1
*/10 * * * * $RUNNER forge  >> /home/robert-nichols/quant_project/Polymarket/logs/agents/forge_cron.log 2>&1
*/10 * * * * $RUNNER axiom  >> /home/robert-nichols/quant_project/Polymarket/logs/agents/axiom_cron.log 2>&1
*/15 * * * * $RUNNER harbor >> /home/robert-nichols/quant_project/Polymarket/logs/agents/harbor_cron.log 2>&1
EOF
) | crontab -

echo "Cron jobs installed:"
crontab -l | grep agent_runner
