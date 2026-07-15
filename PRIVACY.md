# Privacy

Codex Halo is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
- The app may read the account identifier from the login file or token payload only to set the request header expected by the quota service.
- When the user opens Usage Stats, the app reads only timestamps, model identifiers, and token counters from local `CODEX_HOME/sessions` and `CODEX_HOME/archived_sessions` JSONL records. It skips prompts, responses, tool calls, and tool output.

## What It Stores

Codex Halo stores widget preferences in its own application config directory:

- floating-widget visibility
- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- interface language

It also stores a local incremental usage index containing transcript file identifiers, byte cursors, dates, model identifiers, and aggregate token counters. This avoids rescanning full transcripts on every refresh. The index does not contain Codex tokens, account IDs, raw quota responses, user prompts, responses, tool output, chat history, or absolute local paths.

## What It Sends

The app only calls these quota-related HTTPS endpoints from the local desktop process:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

No telemetry, analytics, crash reporting, or third-party tracking is included.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths.

## Accuracy Boundary

Codex Halo displays quota windows returned by the Codex quota service. It does not estimate remaining quota from local token usage and does not fabricate values when the response shape is unknown. Usage Stats is a separate historical view based on the counters Codex recorded locally; it is not a billing statement or a quota calculation.
