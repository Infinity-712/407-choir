"""Install the 407 renewal job without changing unrelated user cron entries."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
job = f"0 */6 * * * /bin/sh {root}/renew.sh >> {root}/state/renew.log 2>&1"
existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
if existing.returncode not in (0, 1):
    raise RuntimeError("Unable to read existing crontab")
if existing.returncode == 1 and "no crontab" not in existing.stderr.lower():
    raise RuntimeError("Unable to read existing crontab")
lines = existing.stdout.splitlines()
if job not in lines:
    subprocess.run(["crontab", "-"], input=existing.stdout.rstrip("\n") + "\n" + job + "\n", text=True, check=True)
check = subprocess.run(["crontab", "-l"], capture_output=True, text=True, check=True)
assert check.stdout.splitlines().count(job) == 1
assert all(line in check.stdout.splitlines() for line in lines)
print("407 renewal installed: every six hours; existing cron entries preserved")
