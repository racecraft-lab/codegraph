# Telemetry Worker - Local Rules

Full detail: root `AGENTS.md`.

- This is a separate Cloudflare Worker surface.
- Preserve privacy defaults: telemetry is disabled by default in this fork, and
  payloads must not contain source code, prompts, secrets, or local paths.
- Validate worker changes with the commands in `telemetry-worker/package.json`.
- Keep environment variables documented without committing secrets.
