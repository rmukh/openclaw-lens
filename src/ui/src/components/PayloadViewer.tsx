import { useState } from 'react';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';
import { useTranslation } from 'react-i18next';
import './call-inspector.css';

type Mode = 'readable' | 'tree' | 'raw';
const stringify = (value: unknown) => JSON.stringify(value, null, 2) ?? 'null';

function ReadableValue({ value, depth = 0, parseJson }: { value: unknown; depth?: number; parseJson: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const [count, setCount] = useState(50);
  const [textLimit, setTextLimit] = useState(8000);
  if (typeof value === 'string') {
    if (parseJson && (value.trimStart().startsWith('{') || value.trimStart().startsWith('['))) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch { /* Keep non-JSON text, including literal backslash sequences. */ }
      if (parsed !== null && typeof parsed === 'object') return <ReadableValue value={parsed} depth={depth} parseJson={false} />;
    }
    return <div><pre className="payload-text">{value.slice(0, textLimit)}</pre>{value.length > textLimit &&
      <button className="inspector-button" onClick={() => setTextLimit(n => n + 32000)}>{t('callInspector.showMore')}</button>}</div>;
  }
  if (value === null || typeof value !== 'object') return <code className="payload-scalar">{String(value)}</code>;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(value) && record.type === 'text' && typeof record.text === 'string') {
    return <ReadableValue value={record.text} depth={depth} parseJson={parseJson} />;
  }
  const entries = Object.entries(value);
  return <details className="payload-object" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{Array.isArray(value) ? '[ ]' : '{ }'} <span>{t('callInspector.items', { count: entries.length })}</span></summary>
    {open && <div className="payload-entries">{entries.slice(0, count).map(([key, child]) => <div className="payload-entry" key={key}>
      <div className="payload-key">{key}</div><ReadableValue value={child} depth={depth + 1} parseJson={parseJson} />
    </div>)}{entries.length > count && <button className="inspector-button" onClick={() => setCount(n => n + 100)}>{t('callInspector.showMore')}</button>}</div>}
  </details>;
}

// The library tree is a compact overview. Readable mode pages large collections
// and mounts only opened branches; Raw/Copy always retain the loaded value.
function treePreview(value: unknown) {
  let remaining = 1200;
  let limited = false;
  const visit = (item: unknown, depth: number): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (depth > 12 || remaining <= 0) { limited = true; return '…'; }
    const entries = Object.entries(item);
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of entries.slice(0, Math.min(100, remaining))) { remaining--; result[key] = visit(child, depth + 1); }
    if (entries.length > Object.keys(result).length) limited = true;
    return Array.isArray(item) ? Object.values(result) : result;
  };
  return { value: visit(value, 0), limited };
}

export default function PayloadViewer({ value, initialMode = 'readable' }: { value: unknown; initialMode?: Mode }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [parseJson, setParseJson] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [rawLimit, setRawLimit] = useState(32000);
  const raw = stringify(value);
  const tree = mode === 'tree' ? treePreview(value) : null;
  async function copy() {
    try { await navigator.clipboard.writeText(typeof value === 'string' ? value : raw); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <div className="payload-viewer">
    <div className="payload-toolbar">
      <div className="inspector-switch" aria-label={t('callInspector.displayMode')}>
        {(['readable', 'tree', 'raw'] as const).map(option => <button key={option} aria-pressed={mode === option} onClick={() => setMode(option)}>{t(`callInspector.${option}`)}</button>)}
      </div>
      <button className="inspector-button" onClick={copy}>{t(copied ? 'callInspector.copied' : 'callInspector.copy')}</button>
    </div>
    {copyError && <p role="status" className="inspector-note">{t('callInspector.copyError')}</p>}
    {mode === 'readable' && <>
      <label className="inspector-option"><input type="checkbox" checked={parseJson} onChange={e => setParseJson(e.target.checked)} />{t('callInspector.parseJson')}</label>
      <ReadableValue key={String(parseJson)} value={value} parseJson={parseJson} />
    </>}
    {mode === 'tree' && <>
      {tree?.limited && <p className="inspector-note">{t('callInspector.treeLimited')}</p>}
      {tree?.value !== null && typeof tree?.value === 'object' ? <JsonView value={tree.value} collapsed={1} shortenTextAfterLength={100}
        enableClipboard={false} displayDataTypes={false} highlightUpdates={false} style={{ ...darkTheme, background: 'transparent', fontSize: 12, overflowWrap: 'anywhere' }}>
        <JsonView.Arrow render={(props, info) => <button type="button" className="payload-tree-arrow" style={props.style}
          aria-label={t('callInspector.fold', { name: String(info.keyName ?? 'JSON') })}
          aria-expanded={props.style?.transform === 'rotate(0deg)'}>▾</button>} />
        <JsonView.CountInfo render={(props, info) => <span style={props.style}>{t('callInspector.items', { count: Object.keys(info.value ?? {}).length })}</span>} />
      </JsonView>
        : <><pre className="payload-text">{raw.slice(0, rawLimit)}</pre>{raw.length > rawLimit && <button className="inspector-button" onClick={() => setRawLimit(n => n + 64000)}>{t('callInspector.showMore')}</button>}</>}
    </>}
    {mode === 'raw' && <>
      <label className="inspector-option"><input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} />{t('callInspector.wrap')}</label>
      <pre className="payload-text" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowX: 'auto' }}>{raw.slice(0, rawLimit)}</pre>
      {raw.length > rawLimit && <button className="inspector-button" onClick={() => setRawLimit(n => n + 64000)}>{t('callInspector.showMore')}</button>}
    </>}
  </div>;
}
