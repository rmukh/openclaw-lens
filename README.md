[English](./README.md) | [中文](./README.zh.md)

# openclaw-lens

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)

**openclaw-lens combines observability, analytics, and developer tooling for [OpenClaw](https://openclaw.ai) agents — cost tracking, session inspection, profiler, cache trace, and security audit in one local dashboard.**

---

## Philosophy

Traditional observability tools assume that the person writing the code, reading the logs, and fixing the bug are the same person. AI agents broke that assumption. The people deploying agents today — founders, analysts, operators — are not the people who built Datadog or Honeycomb, and those tools were never designed to serve them.

openclaw-lens is built for this new reality. Cost, not latency, is the dominant signal. The atomic unit is a session, not a request. And the errors that matter most — an agent reading files it shouldn't, leaking a credential, executing injected instructions — never throw exceptions. You need a tool that shows the real shape of these systems, built for people who are learning to read it.

→ [claw-lens.com/engineering/agent-observability](https://claw-lens.com/engineering/agent-observability)

---

<h2 id="screenshot">Screenshot</h2>

![Overview](./assets/en_screenshot/overview.png)

<details id="more-details">
<summary>More Details (TL;DR)</summary>

### Token Usage
![Token Usage](./assets/en_screenshot/token.png)

### Agents
![Agents](./assets/en_screenshot/agents.png)

### Live Monitor
![Live Monitor](./assets/en_screenshot/live.png)

### Sessions
![Sessions](./assets/en_screenshot/sessions.png)
![Session Details](./assets/en_screenshot/sessions_details.png)
![Session Messages](./assets/en_screenshot/sessions_msg.png)

### Cron
![Cron](./assets/en_screenshot/cron.png)

### Memory
![Memory](./assets/en_screenshot/memory.png)

### Audit
![Audit](./assets/en_screenshot/audit.png)
![Audit Event Details](./assets/en_screenshot/audit_eventdetails.png)
![Audit Agent Status](./assets/en_screenshot/audit_agentstatus.png)

### Session Timeline
![Timeline](./assets/en_screenshot/timeline.png)
![Timeline Error Step](./assets/en_screenshot/timeline_errorstep.png)

### Profiler
![Profiler](./assets/en_screenshot/profiler.png)

### Deep Turns
![Deep Turns](./assets/en_screenshot/deepturn.png)

### Context Breakdown
![Context Breakdown](./assets/en_screenshot/contextbreakdown.png)

### Cache Trace
![Cache Trace](./assets/en_screenshot/cachetrace.png)

[Back to top](#more-details)

</details>

---

## Features

- **Overview** — KPI strip (cost today, tokens, sessions, errors, cache efficiency), 7-day trend, week-over-week delta, model cost breakdown, active agent list
- **Token Usage** — 4-dimension cost breakdown (input, output, cache read, cache write) by agent, model, and time period; cache hit rate; cron vs. manual comparison
- **Agents** — per-agent statistics, cost, session count, and agent memory files
- **Live Monitor** — real-time agent activity feed via WebSocket proxy to the OpenClaw Gateway
- **Sessions** — session table with filters by agent, model, date, cost; sorting by last activity, start time, duration, and average tokens per message in either direction, alongside existing sorts; context health indicator; full tool call trace per session
- **Cron** — scheduled task list, run history, status, and cost tracking
- **Memory** — agent workspace and memory file viewer across all agents
- **Audit** — security event timeline with rule-based risk scoring (high/medium/low) for file access, shell commands, external HTTP calls, sensitive data exposure (34 regex patterns), prompt injection detection (9 patterns), and per-agent behavioral anomaly detection over 30-day baselines
- **Session Timeline** — turn-by-turn message trace with token counts, stop reasons, and tool call details; session-specific tool colors chosen for perceptual separation, including custom tools, with stripe patterns for crowded palettes and red outlines for failed calls
- **Profiler** — session rankings by token consumption and tool timing analysis
- **Deep Turns** — detects deep turn sequences with repetitive tool patterns, unique-ratio scoring, and per-agent breakdown
- **Context Breakdown** — per-turn context window fill visualization with system/history/tool-result token splits and model-accurate capacity gauge
- **Cache Trace** — step-through replay of OpenClaw's cache trace logs, showing stage progression, digest changes, and model config
- **i18n** — English and Chinese interface
- **All data stays local** — reads from OpenClaw's JSONL logs on disk, no data sent to any external server

For detailed per-page, per-tab documentation: **[claw-lens.com/monitoring/overview](https://claw-lens.com/monitoring/overview)**

In Token Usage's **Breakdown** section, **This Week (Mon–today)** starts at local
midnight on Monday. **Custom range** uses two calendar inputs separated by `-`,
including both selected dates. These filters apply to the agent, model, and
cron/manual breakdowns independently of the Summary and Token Trend controls.
**Token Usage by Agent** has its own identical picker: Today, This Week,
Last 7/30/90 Days, All Time, By Day, By Week, and Custom range. Its totals,
shares, session counts, and expanded top sessions all use that section's selected
range. The picker stays visible when no usage matches. All Time in these two
sections includes the full recorded history.

Both sections show separate **LLM responses** and **Tool calls** counts, with
per-tool details and counts by agent, model, cron/manual, and expanded sessions.
An LLM response is a recorded assistant reply, including one requesting tools;
it is not a verified API-request count. Each recorded tool request counts once,
including failed or unfinished attempts, while its result does not count again.
Both counts use the originating reply's date and the same message exclusions as
token totals. Zero-cost replies and replies without usage metadata count too.
These are recorded activity counts, not provider billing statistics; events absent
from OpenClaw logs cannot be counted. Counts display as exact integers.

In Sessions, choose the sort field in the dropdown and click the adjacent arrow
button to switch between ↑ ascending and ↓ descending. Direction applies to every
field. Last active is the default and includes the former Newest sort behavior.

The activity badge describes the latest recorded turn. A final `stop`, `error`,
`aborted`, or `length` response becomes **Idle** immediately after ingestion.
Recent user messages awaiting a reply and unfinished tool turns show **In progress**
(inferred from logs). After ten minutes without updates, unfinished turns show
**Unknown**, rather than assuming completion. Hover over the badge for its reason.
**Active now** counts these inferred in-progress turns. Live log updates refresh
the table, with periodic polling as a fallback.

This tracks turn activity, not TUI process lifetime: `/exit` can close a TUI
without writing a session exit record, and a gateway run may continue afterward.
Direct OpenClaw launches therefore do not claim an **Exited** status.

Select **Custom range** in the time filter to choose start and end dates, shown
as two calendar inputs separated by `-`. Both dates are included in your local
timezone. Sessions appear when they have any message in that interval, even if
they also have newer activity. Token, cost, error, and cache totals reflect only
messages within the interval. Missing or reversed dates show a validation message.

The **Workspace / Run** column shows the workspace folder above the session's
name or run key. Filter by workspace, or search by workspace, session name, agent,
routing key, or session ID. Hover over a workspace to see its full path; expand a
session for the full path and routing key. Names come from OpenClaw's session
index and transcript metadata. Older sessions without metadata fall back to the
agent name, with an empty run shown as `—`.
New agent directories are discovered automatically while the dashboard is
running; the table displays their sessions on its next refresh.

For example, after configuring agents `workspace-1` and `workspace-2` with their
respective workspace directories, start named runs with:

```bash
openclaw agent --agent workspace-1 --session-key agent:workspace-1:run1 --message "Inspect this workspace"
openclaw agent --agent workspace-1 --session-key agent:workspace-1:run2 --message "Review the changes"
openclaw agent --agent workspace-2 --session-key agent:workspace-2:run1 --message "Inspect this workspace"
```

`--agent` selects the configured agent ID; `--session-key` selects the run.
An agent-prefixed key must use that same agent ID. Workspace paths come from the
transcript, session-specific workspace metadata, or agent configuration.

---

## Quick Start

```bash
npx claw-lens-cli
```

Opens `http://localhost:4242`. No account, no config, no data upload.

```bash
npm install -g claw-lens-cli   # or install globally
claw-lens --port 3000      # custom port (default: 4242)
claw-lens --no-open        # suppress auto-open browser
```

Requires Node.js 18+. `OPENCLAW_HOME` env var overrides the default `~/.openclaw` data directory.

For more CLI options, see [claw-lens.com/reference/cli](https://claw-lens.com/reference/cli).

### For Developers

```bash
git clone https://github.com/msfirebird/claw-lens.git
cd claw-lens
npm install
cd src/ui && npm install && cd ../..
npm run dev
```

Runs backend (Express + ts-node-dev, port 4242) and frontend (React + Vite, port 6060) concurrently with hot reload. Changes to `src/server/` or `src/ui/` apply instantly.
The frontend waits for the API to finish loading sessions before starting. Open
<http://localhost:6060> for development; port 4242 serves the API only, even if a
previous production build exists. `npm run dev:ui` also requires a running backend.

For development with a separate database, run `npm run dev:local`. The dashboard
is available at <http://localhost:6060> and the API at <http://localhost:4242>.
This mode reads your local OpenClaw sessions and stores its database in
`.dev/claw-lens.db`, leaving the installed dashboard's database separate.

Run `npm run dev:demo` to try the timeline colors and session sorting with four
synthetic sessions across two workspaces, including named runs, a legacy session
without metadata, custom tool names, and failed tool calls. Demo
logs are stored in `.dev/demo-openclaw/` and their database in `.dev/demo.db`.
This mode never executes tools or modifies your OpenClaw installation.
Demo timestamps are generated at startup, with current token usage included even
just after midnight. Restart the demo to refresh its dates. A demo left running
overnight can have no usage in Today or This Week after the calendar rolls over.

Both commands support hot reload. Stop the current development server with
Ctrl+C before switching modes, since they use the same ports. Run `npm test`
for the palette, session sorting, and session-file discovery regression checks.

```bash
npm run build && npm start   # production build
```

→ [claw-lens.com/development](https://claw-lens.com/development)

---

## Architecture

openclaw-lens runs entirely on your machine. It reads the files OpenClaw already writes to disk — session JSONL, cache traces, cron configs, agent memory — parses session logs into SQLite, and serves everything through an Express API to a React frontend. No external services, no deployment, no configuration files.

Four principles shape the architecture:

- **Zero configuration** — `npx claw-lens-cli` auto-creates the schema, ingests all session data, and opens the browser. The only prerequisite is Node.js.
- **Cost first** — USD cost is the primary signal, visible per-session, per-model, and per-agent. Token breakdowns are one layer deeper for when users need them.
- **Local and read-only** — the server binds to `127.0.0.1`, makes no outbound calls, and never modifies agent files. The only file openclaw-lens writes is its own SQLite database.
- **Rule-based security audit** — every tool call is risk-scored at ingestion time with deterministic rules, not ML. Per-agent behavioral baselines detect anomalies. The rules are transparent — read the code and know exactly why something was flagged.

Full design doc with data model, technical choices, and trade-offs: **[claw-lens.com/engineering/design-doc](https://claw-lens.com/engineering/design-doc)**

---

## Data Sources

openclaw-lens reads directly from the local OpenClaw data directory (`~/.openclaw/` by default):

| Path | Content |
|------|---------|
| `agents/*/sessions/*.jsonl` | Session logs (including `.deleted` and `.reset` suffixed files) |
| `logs/cache-trace.jsonl` | Cache trace for replay and context breakdown *(note: cache trace requires to be enabled in OpenClaw — [how to enable](https://claw-lens.com/reference/data-storage#cache-trace-retention))* |
| `cron/` | Cron job definitions and state |
| `workspace-*/`, `agents/*/workspace/` | Agent memory and workspace files |
| `openclaw.json` | Gateway auth token for live WebSocket connection |

openclaw-lens writes only one file: `~/.openclaw/claw-lens.db` (SQLite).

---

> **All data stays local.** openclaw-lens binds to `127.0.0.1`, restricts CORS to localhost, makes no outbound HTTP calls, and sends no telemetry. The only network connection is the WebSocket to your local OpenClaw Gateway. Nothing leaves your machine.

---

## License

[MIT](./LICENSE)
