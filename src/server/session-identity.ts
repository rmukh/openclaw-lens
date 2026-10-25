import * as fs from 'fs';
import * as path from 'path';
import { getClawHome } from './paths';

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readObject(file: string): JsonObject {
  try { return object(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return {}; } // Missing/partially written stores must not hide the sessions table.
}
function folderName(directory: string): string {
  return directory.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || directory;
}

export interface SessionIdentitySource {
  id: string;
  agent_name: string;
  workspace_path?: string | null;
  session_label?: string | null;
}
export interface SessionIdentity {
  workspace_name: string;
  workspace_path: string | null;
  session_name: string | null;
  session_key: string | null;
}

/** Read each agent's store once per request, so session renames are visible
 * without re-ingesting transcripts. Match by UUID, never by filesystem order.
 */
export function createSessionIdentityResolver(clawHome = getClawHome()) {
  const config = readObject(path.join(clawHome, 'openclaw.json'));
  const agents = object(config.agents);
  const configured = Array.isArray(agents.list) ? agents.list.map(object) : [];
  const stores = new Map<string, Map<string, { key: string; entry: JsonObject }>>();
  return (session: SessionIdentitySource): SessionIdentity => {
    let store = stores.get(session.agent_name);
    if (!store) {
      store = new Map();
      // Agent ids come from local transcript directories, but never traverse paths.
      if (/^[a-z0-9_-]+$/i.test(session.agent_name)) {
        const entries = readObject(path.join(clawHome, 'agents', session.agent_name, 'sessions', 'sessions.json'));
        const sorted = Object.entries(entries).sort(([a, av], [b, bv]) =>
          (Number(object(bv).updatedAt) || 0) - (Number(object(av).updatedAt) || 0) || a.localeCompare(b));
        for (const [key, value] of sorted) {
          const entry = object(value);
          const id = text(entry.sessionId);
          if (id && !store.has(id)) store.set(id, { key, entry });
        }
      }
      stores.set(session.agent_name, store);
    }
    const match = store.get(session.id);
    const entry = match?.entry ?? {};
    const agent = configured.find(a => a.id === session.agent_name);
    const defaultAgent = configured.find(a => a.default === true)?.id ?? configured[0]?.id ?? 'main';
    const workspacePath = text(entry.spawnedWorkspaceDir) ?? text(session.workspace_path)
      ?? text(agent?.workspace)
      ?? (session.agent_name === defaultAgent ? text(object(agents.defaults).workspace) : null);
    const key = match?.key ?? null;
    const prefix = `agent:${session.agent_name}:`;
    // Retain the whole suffix, including channel/thread segments when present.
    const run = key?.startsWith(prefix) ? key.slice(prefix.length) : key;
    return {
      workspace_name: workspacePath ? folderName(workspacePath) : session.agent_name,
      workspace_path: workspacePath,
      session_name: text(entry.label) ?? text(session.session_label) ?? text(entry.displayName) ?? text(run),
      session_key: key,
    };
  };
}
