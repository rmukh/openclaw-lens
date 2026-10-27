# Changelog

## Unreleased

### Added

- Inspect individual Execution Gantt tool/LLM calls in an on-demand side panel, with foldable Readable/Tree views, original Raw records, JSON-in-text expansion, copy/wrap controls, and progressive payload previews. Read full recorded results for custom tools independently of audit previews; distinguish captured step input from reconstructed conversation and shared run context. Include English/Chinese labels and richer demo payloads/traces.
- Separate recorded LLM-response and tool-call counts in Token Usage's Breakdown and Token Usage by Agent sections, with per-tool details, agent/model/cron/manual counts, and counts for expanded sessions. Each section follows its own selected dates; counts do not estimate provider billing.
- Give Token Usage by Agent the same independent period picker as Breakdown, including Monday-based This Week, day/week navigation, and inclusive custom ranges. Expanded sessions follow the selected bounds, and empty ranges retain usable controls.
- “This Week (Mon–today)” and custom calendar ranges in Token Usage's Breakdown section. All agent/model/cron breakdowns use the selected interval, with timezone-aware boundaries and inclusive custom end dates.
- Custom date ranges in Sessions, with start/end calendar inputs, inclusive local dates, and validation. Session membership and token/cost/error/cache totals use the selected range.
- A combined Workspace / Run column in Sessions, with workspace filtering and search by workspace, run/session name, agent, routing key, or UUID. Expanded details include the workspace path and session key.
- Workspace and session-name metadata from OpenClaw transcripts, agent configuration, and session indexes. Existing databases automatically re-ingest transcript metadata; older unnamed sessions remain visible.
- Demo coverage for two workspaces, multiple runs, a named session, and a legacy session without metadata.

### Changed

- Remove the redundant “Sort:” prefix from sort option labels.
- Replace the sort direction dropdown with an arrow button that toggles ascending/descending, including keyboard support and accessible state.

### Fixed

- Reject captured-input matches when tool arguments/names differ, completion snapshots conflict, or stream steps reuse sequence numbers. Preserve recorded-context fallback instead of choosing inconsistent trace evidence.
- Recognize nonzero tool exit codes and explicit error flags even when OpenClaw reports the execution status as completed. Verified with real Python skill runs, including argument-validation failure and recovery.
- Keep transcript and audit ingestion in one transaction using a single file snapshot, and retry files after an audit failure. Handle conflicting result revisions, malformed IDs/content, and corrected tool names without stale pairing; exclude runtime-generated messages from user-prompt audit context and cache ancestor context for long runs.
- Pair execution Gantt tool results and audit details by agent/session/message/call IDs instead of tool-name/timestamp proximity. Share legacy/modern transcript matching between parsers, resolve reused IDs through parent-message ancestry, and show missing or ambiguous outcomes as Unknown. The additive migration preserves old audit records and dismissed findings; legacy audit details remain unlinked until normal re-ingestion.
- Avoid aborting live WebSocket handshakes during React development checks or page navigation, preventing repeated Windows `ECONNABORTED` proxy errors while keeping reconnects and live updates working.
- Keep the development dashboard on port 6060, wait for API readiness before starting Vite, and stop both development processes when either exits. Use the backend's IPv4 address for HTTP/WebSocket proxying.
- Locate OpenClaw through Windows npm shims as well as Unix executables, without printing a missing `which` error on Windows.
- Refresh session, message, and tool timestamps when changed transcripts are re-ingested, so restarting demos updates date-filtered usage in an existing database.
- Generate demo sessions with current token-bearing final replies, including immediately after midnight on Monday, and keep all demo timestamps at or before startup time.
- Use full recorded history for All Time in both token sections, and apply consistent validated range bounds and billable-message filters to agent totals and expanded sessions.
- Derive Sessions activity from the latest real message and tool activity instead of labelling every recently updated session as Running. Closed turns become Idle, unfinished recent turns show In progress, and stale/ambiguous turns show Unknown. Refresh statuses on live log updates and keep Active now consistent with the badges.
- Preserve the browser's HTTP origin through the development WebSocket proxy so live updates pass the server's localhost origin check.
- Count all sessions contributing tokens within a breakdown range, including sessions with later activity outside that range; avoid displaying unrelated summary data while a breakdown is loading or invalid.
- Eliminate the execution Gantt's horizontal overflow by reserving space for turn durations, keeping endpoint ticks inside the plot, and adapting the chart to narrow widths.
- Keep a single pending gateway reconnect when offline, preventing exponential retry growth and excessive memory use.
- Treat Windows path separators correctly when locating session directories for live updates.
- Discover agent/session directories created while the dashboard is running and ingest their logs automatically.

## v0.2.2

### Added

- Session-specific timeline palettes that maximize perceptual color separation, including custom tools. Crowded palettes gain stripe patterns, and failed calls retain their tool color with a red outline.
- Separate dropdowns for session sort field and direction (↑ ascending, ↓ descending). All fields support both directions, including last activity, start time, duration, average tokens per message, tokens, cost, errors, and cache hit rate. Sorting also applies when searching by session ID.
- Cross-platform development commands: `npm run dev:local` uses a separate development database; `npm run dev:demo` provides four synthetic sessions with custom tools and failures.
- Regression checks for tool palettes, session sorting, and session-file discovery, available through `npm test`.

### Fixed

- Discover OpenClaw session logs on Windows by treating backslashes as path separators in glob patterns.

## v0.1.0

Initial release. claw-lens combines observability, analytics, and developer tooling for OpenClaw agents — cost tracking, session inspection, profiler, cache trace, and security audit in one local dashboard at `http://localhost:4242`.

**Pages**

- **Overview** — KPI strip (cost today, tokens, sessions, errors, cache efficiency), 7-day trend, week-over-week delta, model cost breakdown, active agent list
- **Token Usage** — 4-dimension cost breakdown (input, output, cache read, cache write) by agent, model, and time period; cache hit rate; cron vs. manual comparison
- **Agents** — per-agent statistics, cost, session count, and memory file viewer
- **Sessions** — session table with filters by agent, model, date, cost; context health indicator; full tool call trace per session
- **Session Timeline** — turn-by-turn message trace with token counts, stop reasons, and tool call details
- **Context Breakdown** — per-turn context window fill visualization with system/history/tool-result token splits and model-accurate capacity gauge
- **Profiler** — session rankings by token consumption and tool timing analysis
- **Deep Turns** — detects deep turn sequences with repetitive tool patterns, unique-ratio scoring, and per-agent breakdown
- **Cache Trace** — step-through replay of OpenClaw's cache trace logs, showing stage progression, digest changes, and model config
- **Cron** — scheduled task list, run history, status, and cost tracking
- **Memory** — agent workspace and memory file viewer across all agents
- **Live Monitor** — real-time agent activity feed via WebSocket proxy to OpenClaw Gateway
- **Audit** — security event timeline with rule-based risk scoring (high/medium/low) for file access, shell commands, external HTTP calls, sensitive data exposure (34 regex patterns), prompt injection detection (9 patterns), and per-agent behavioral anomaly detection over 30-day baselines

**Other**

- CLI flags: `--port`, `--no-open`
- English and Chinese interface (i18n)
- All data stays local — no telemetry, no external calls

🦞 Easter egg: meet your new pet. Go to Settings to adopt a claw.
