import * as fs from 'fs';
import * as path from 'path';

/** Synthetic OpenClaw logs for repeatable UI debugging; no tools are executed. */
export function createDemoData(dataDir: string): string {
  const home = path.join(dataDir, 'demo-openclaw');
  const sessions = path.join(home, 'agents', 'demo', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const tools = ['exec', 'process', 'read', 'web_search', 'web_fetch',
    'custom.search_documents', 'custom.render_report', 'write', 'edit'];
  const now = Date.now();
  for (let session = 0; session < 4; session++) {
    const id = `00000000-0000-4000-8000-${String(session + 1).padStart(12, '0')}`;
    const start = now - (4 - session) * 3_600_000;
    // The oldest session is most recently active; duration and avg/msg differ too.
    const step = [1_600_000, 25_000, 120_000, 12_000][session];
    const tokens = [1000, 20000, 4000, 8000][session];
    const records: unknown[] = [];
    let parentId: string | null = null;
    const add = (suffix: string, timestamp: number, message: Record<string, unknown>, logged = timestamp) => {
      const messageId = `${id}-${suffix}`;
      records.push({ type: 'message', id: messageId, parentId,
        timestamp: new Date(logged).toISOString(), message: { ...message, timestamp } });
      parentId = messageId;
    };
    add('user', start, { role: 'user', content: [{ type: 'text', text: 'Demo: inspect tools, custom functions, and session sorting.' }] });
    const sessionTools = session === 0 ? tools : tools.slice(0, session + 2);
    sessionTools.forEach((name, i) => {
      const timestamp = start + 1000 + i * step;
      const toolId = `${id}-call-${i}`;
      add(`assistant-${i}`, timestamp, { role: 'assistant', model: 'demo-model', stopReason: 'toolUse',
        usage: { input: tokens, output: 100, totalTokens: tokens + 100, cacheRead: 0, cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [{ type: 'toolCall', id: toolId, name, arguments: { demo: true } }],
      }, timestamp + 1000);
      add(`result-${i}`, timestamp + 9000, { role: 'toolResult', toolCallId: toolId, toolName: name,
        details: { durationMs: 8000, status: i === 2 ? 'error' : 'completed' },
        content: [{ type: 'text', text: i === 2 ? 'Simulated tool failure for debugging.' : 'Simulated result; no tool was executed.' }],
      });
    });
    add('done', start + sessionTools.length * step + 10000, { role: 'assistant', model: 'demo-model',
      stopReason: 'stop', content: [{ type: 'text', text: 'Demo session complete.' }] });
    fs.writeFileSync(path.join(sessions, `${id}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  return home;
}
