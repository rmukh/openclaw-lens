import * as fs from 'fs';
import * as path from 'path';

/** Synthetic OpenClaw logs for repeatable UI debugging; no tools are executed. */
export function createDemoData(dataDir: string, now = Date.now()): string {
  const home = path.join(dataDir, 'demo-openclaw');
  const stores = new Map<string, Record<string, unknown>>();
  const agents = ['workspace-1', 'workspace-2', 'demo'];
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'openclaw.json'), JSON.stringify({ agents: { list: agents.map(id => ({
    id, ...(id !== 'demo' ? { workspace: path.join(dataDir, 'workspaces', id) } : {}),
  })) } }, null, 2));
  const tools = ['exec', 'process', 'read', 'web_search', 'web_fetch',
    'custom.search_documents', 'custom.render_report', 'write', 'edit'];
  const cacheTrace: unknown[] = [];
  for (let session = 0; session < 4; session++) {
    const id = `00000000-0000-4000-8000-${String(session + 1).padStart(12, '0')}`;
    const agent = ['workspace-1', 'workspace-1', 'workspace-2', 'demo'][session];
    const sessions = path.join(home, 'agents', agent, 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    // Remove only our old generated transcript when moving a demo to its new agent.
    const oldFile = path.join(home, 'agents', 'demo', 'sessions', `${id}.jsonl`);
    if (agent !== 'demo' && fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    // The oldest session is most recently active; duration and avg/msg differ too.
    const step = [1_600_000, 25_000, 120_000, 12_000][session];
    const sessionTools = session === 0 ? tools : tools.slice(0, session + 2);
    // Include current billable activity even just after midnight on Monday.
    // Anchor the end first so no generated message is in the future.
    const end = session === 0 || session === 3 ? now : now - (4 - session) * 3_600_000;
    const start = end - (sessionTools.length * step + 10000);
    const tokens = [1000, 20000, 4000, 8000][session];
    const records: unknown[] = [];
    if (agent !== 'demo') {
      const cwd = path.join(dataDir, 'workspaces', agent);
      fs.mkdirSync(cwd, { recursive: true });
      records.push({ type: 'session', version: 3, id, timestamp: new Date(start).toISOString(), cwd });
      if (session === 1) records.push({ type: 'session_info', name: 'Review changes' });
      const store = stores.get(agent) ?? {};
      store[`agent:${agent}:run${session === 1 ? 2 : 1}`] = { sessionId: id, updatedAt: now };
      stores.set(agent, store);
    }
    let parentId: string | null = null;
    const add = (suffix: string, timestamp: number, message: Record<string, unknown>, logged = timestamp) => {
      const messageId = `${id}-${suffix}`;
      records.push({ type: 'message', id: messageId, parentId,
        timestamp: new Date(logged).toISOString(), message: { ...message, timestamp } });
      parentId = messageId;
    };
    add('user', start, { role: 'user', content: [{ type: 'text', text: 'Demo: inspect tools, custom functions, and session sorting.' }] });
    sessionTools.forEach((name, i) => {
      const timestamp = start + 1000 + i * step;
      const toolId = `${id}-call-${i}`;
      add(`assistant-${i}`, timestamp, { role: 'assistant', model: 'demo-model', stopReason: 'toolUse',
        usage: { input: tokens, output: 100, totalTokens: tokens + 100, cacheRead: 0, cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: 'text', text: `Demo: request ${name}. No real tool will execute.` },
          { type: 'toolCall', id: toolId, name, arguments: {
            demo: true,
            ...(name === 'exec' ? { command: 'python3 scripts/model_usage.py --input costs.json --mode all --format json --pretty',
              workdir: './demo-workspace', options: { models: ['demo-alpha', 'demo-beta'], note: 'First line\nSecond line\twith indentation', literalPath: 'C:\\demo\\reports' } } : {}),
            ...(name.startsWith('custom.') ? { input: { query: 'demo report', filters: { tags: ['python', 'json'], active: true } } } : {}),
          } }],
      }, timestamp + 1000);
      add(`result-${i}`, timestamp + 9000, { role: 'toolResult', toolCallId: toolId, toolName: name,
        details: { durationMs: 8000, status: i === 2 ? 'error' : 'completed' },
        content: [{ type: 'text', text: i === 2 ? 'Simulated tool failure for debugging.' : name === 'exec' ? JSON.stringify({
          note: 'Simulated result; no tool was executed.', mode: 'all', models: [{ model: 'demo-alpha', totalCostUSD: 0.5 }, { model: 'demo-beta', totalCostUSD: 0.1 }],
          report: 'Summary\n\tTwo models completed.\r\nLiteral path: C:\\demo\\reports',
        }, null, 2) : name === 'custom.render_report' ? 'Report generated\n\tRows: 2\n\tStatus: complete\n\nSimulated result; no tool was executed.' : 'Simulated result; no tool was executed.' }],
      });
    });
    add('done', end, { role: 'assistant', model: 'demo-model',
      usage: { input: tokens, output: 100, totalTokens: tokens + 100, cacheRead: 0, cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', content: [{ type: 'text', text: 'Demo session complete.\n\nOpen a tool bar or Inspect button to explore arguments, results, and the recorded LLM response.' }] });
    fs.writeFileSync(path.join(sessions, `${id}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
    // Synthetic captures use the same run/step structure as the real Python skill traces.
    const messages = (records as Array<{ type: string; message?: Record<string, unknown> }>).filter(record => record.type === 'message').map(record => record.message!);
    const runId = `${id}-demo-run`;
    const system = 'Synthetic demo capture for the Lens call inspector. No provider or tool was invoked.';
    let seq = 0;
    messages.forEach((message, index) => {
      if (message.role === 'assistant') cacheTrace.push({ sessionId: id, runId, stage: 'stream:context', seq: ++seq,
        system, messages: messages.slice(0, index), options: { model: { id: 'demo-model' } }, ts: new Date(end).toISOString() });
    });
    const runtime = (type: string, data: unknown) => ({ traceSchema: 'openclaw-trajectory', schemaVersion: 1, source: 'runtime',
      sessionId: id, runId, type, data, ts: new Date(end).toISOString() });
    fs.writeFileSync(path.join(sessions, `${id}.trajectory.jsonl`), [
      runtime('context.compiled', { transcriptLeafId: `${id}-user`, systemPrompt: system, prompt: 'Inspect the synthetic demo tools.', messages: [], tools: sessionTools.map(name => ({ name })) }),
      runtime('model.completed', { messagesSnapshot: messages }),
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
  }
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(home, 'logs', 'cache-trace.jsonl'), cacheTrace.map(record => JSON.stringify(record)).join('\n') + '\n');
  for (const [agent, store] of stores) {
    fs.writeFileSync(path.join(home, 'agents', agent, 'sessions', 'sessions.json'), JSON.stringify(store, null, 2));
  }
  return home;
}
