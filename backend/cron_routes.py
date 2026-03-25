"""
Cron job management routes for automated scheduling of backtests and monitoring.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import subprocess
import shlex

router = APIRouter(prefix="/api/cron", tags=["cron"])

@router.get("/status")
async def get_cron_status():
    """
    Check if cron is enabled by looking for the polyback job in crontab.
    """
    try:
        # Run 'crontab -l' and grep for our job
        result = subprocess.run(
            ["crontab", "-l"],
            capture_output=True,
            text=True,
            check=False
        )

        crontab_output = result.stdout
        status = "enabled" if "# PolyBack" in crontab_output or "polyback" in crontab_output else "disabled"

        return {
            "enabled": status == "enabled",
            "status": status
        }
    except FileNotFoundError:
        # crontab not found or not accessible
        return {"enabled": False, "status": "disabled"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check cron status: {str(e)}")


@router.post("/{action}")
async def toggle_cron(action: str):
    """
    Enable or disable the cron job.
    Action can be 'enable' or 'disable'.
    """
    if action not in ("enable", "disable"):
        raise HTTPException(status_code=400, detail="Invalid action. Use 'enable' or 'disable'.")

    try:
        # Get current crontab
        result = subprocess.run(
            ["crontab", "-l"],
            capture_output=True,
            text=True,
            check=False
        )

        current_crontab = result.stdout
        
        # Define our job - using echo for demo in project
        # In production, replace with: /path/to/backend/cron/runner.py
        job = "# PolyBack automated scheduler\n0 * * * * echo 'PolyBack cron job running at $(date)'" if action == "enable" else ""

        if action == "enable":
            # Check if already enabled
            if "# PolyBack" in current_crontab:
                return {"enabled": True, "message": "Cron is already enabled"}

            # Add job to crontab
            new_crontab = current_crontab + job + "\n"
            result = subprocess.run(
                ["crontab", "-"],
                input=new_crontab,
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Failed to enable cron: {result.stderr.decode('utf-8')}")

            return {"enabled": True, "message": "Cron job enabled successfully"}
        else:
            # Remove job from crontab
            lines = current_crontab.split("\n")
            new_lines = [line for line in lines if line.strip() and not (line.strip().startswith("# PolyBack") or line.strip() == "0 * * * * echo 'PolyBack cron job running at $(date)'")]
            new_crontab = "\n".join(new_lines).strip()

            result = subprocess.run(
                ["crontab", "-"],
                input=new_crontab,
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode != 0:
                raise HTTPException(status_code=500, detail=f"Failed to disable cron: {result.stderr.decode('utf-8')}")

            return {"enabled": False, "message": "Cron job disabled successfully"}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Command timed out - cron edit took too long")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to {action} cron: {str(e)}")


@router.post("/set-schedule")
async def set_schedule(schedule: str):
    """
    Set a custom cron schedule.
    Schedule should be in cron format (e.g., "0 * * * *").
    """
    # Basic validation of cron schedule
    parts = schedule.split()
    if len(parts) != 5:
        raise HTTPException(status_code=400, detail="Schedule must have 5 parts (minute hour day month weekday)")

    try:
        result = subprocess.run(
            ["crontab", "-l"],
            capture_output=True,
            text=True,
            check=False
        )

        current_crontab = result.stdout
        
        # Using the provided schedule
        job = f"# PolyBack custom scheduler\n{schedule} echo 'PolyBack scheduled job at $(date)'"

        new_crontab = current_crontab + job + "\n"

        result = subprocess.run(
            ["crontab", "-"],
            input=new_crontab,
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Failed to set schedule: {result.stderr.decode('utf-8')}")

        return {
            "enabled": True,
            "message": f"Schedule set to '{schedule}'",
            "schedule": schedule
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set schedule: {str(e)}")
