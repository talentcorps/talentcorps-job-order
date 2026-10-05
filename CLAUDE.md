# CLAUDE.md — talentcorps-job-order

## Security

- **Never write or execute shell scripts in /tmp. Run commands inline, or put helper scripts in the repo's own gitignored .scratch/ folder. Never chmod +x anything outside the repo.** (Bryan, 2026-10-05: security tooling (SOC) flagged `chmod +x /tmp/*.sh` and `bash /tmp/*.sh` as anomalous.)

> **Before any task-numbered work, follow STEP 0 in https://github.com/talentcorps/talentcorps-home/blob/main/docs/SHELL_CONVENTIONS.md — this is a mandatory protocol, not a suggestion.**
