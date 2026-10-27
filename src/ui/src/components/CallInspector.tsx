import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PayloadViewer from './PayloadViewer';
import './call-inspector.css';

export interface CallSelection {
  session: string;
  agent: string;
  message: string;
  tool?: string;
  name: string;
}
type Section = 'arguments' | 'result' | 'response' | 'context' | 'raw';
interface Detail {
  status: 'available' | 'missing' | 'ambiguous' | 'unreadable' | 'too_large';
  source: 'transcript' | 'recorded_context' | 'cache_trace';
  truncated: boolean;
  value?: unknown;
  preview?: string;
  characters: number;
  limit: number;
  metadata?: { complete?: boolean; capturedInput?: string; unfinished?: boolean; scope?: string };
}

function PayloadRequest({ url, section, limit, onMore }: { url: string; section: Section; limit: number; onMore: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ data?: Detail; error?: boolean }>({});
  const [previewLimit, setPreviewLimit] = useState(32000);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { fetch(url, { signal: controller.signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('Unable to load call');
      return response.json() as Promise<Detail>;
    }).then(data => { if (!controller.signal.aborted) setState({ data }); })
      .catch(() => { if (!controller.signal.aborted) setState({ error: true }); }); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [url]);
  if (state.error) return <p role="alert" className="inspector-note">{t('callInspector.loadError')}</p>;
  if (!state.data) return <p role="status" className="inspector-note">{t('callInspector.loading')}</p>;
  const data = state.data;
  if (data.status !== 'available') return <p role="status" className="inspector-note">{t(`callInspector.status_${data.status}`)}</p>;
  return <>
    <div className="inspector-source">{t(`callInspector.source_${data.source}`)}</div>
    {section === 'context' && <p className="inspector-note">{t(data.source === 'cache_trace' ? 'callInspector.capturedHelp' : 'callInspector.contextHelp')}</p>}
    {data.metadata?.complete === false && <p className="inspector-note">{t('callInspector.partialContext')}</p>}
    {data.metadata?.capturedInput === 'ambiguous' && <p className="inspector-note">{t('callInspector.ambiguousContext')}</p>}
    {data.metadata?.unfinished && <p className="inspector-note">{t('callInspector.unfinished')}</p>}
    {data.truncated ? <>
      <p className="inspector-note">{t('callInspector.truncated', { loaded: data.limit.toLocaleString(), total: data.characters.toLocaleString() })}</p>
      <pre className="payload-text">{data.preview?.slice(0, previewLimit)}</pre>
      {(data.preview?.length ?? 0) > previewLimit && <button className="inspector-button" onClick={() => setPreviewLimit(n => n + 64000)}>{t('callInspector.showMore')}</button>}
      {limit < 2_097_152 ? <button className="inspector-button" onClick={onMore}>{t('callInspector.loadMore')}</button> : <p className="inspector-note">{t('callInspector.payloadLimit')}</p>}
    </> : <PayloadViewer value={data.value} initialMode={section === 'raw' ? 'raw' : section === 'arguments' ? 'tree' : 'readable'} />}
  </>;
}

export default function CallInspector({ selection, onClose }: { selection: CallSelection; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>(selection.tool ? 'arguments' : 'response');
  const [limit, setLimit] = useState(65536);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = oldOverflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const query = new URLSearchParams({ agent: selection.agent, message: selection.message, section, limit: String(limit) });
  if (selection.tool) query.set('tool', selection.tool);
  const url = `/api/debug/session/${encodeURIComponent(selection.session)}/call?${query}`;
  const sections: Section[] = selection.tool ? ['arguments', 'result', 'response', 'context', 'raw'] : ['context', 'response', 'raw'];
  return <dialog ref={dialog} className="call-inspector" aria-labelledby="call-inspector-title" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) onClose(); }}>
    <div className="inspector-header">
      <div><div className="inspector-eyebrow">{t(selection.tool ? 'callInspector.toolCall' : 'callInspector.llmCall')}</div>
        <h2 id="call-inspector-title">{selection.name}</h2></div>
      <button autoFocus className="inspector-close" onClick={onClose} aria-label={t('callInspector.close')}>×</button>
    </div>
    <div className="inspector-identity"><span>{selection.agent}</span><code title={selection.tool ?? selection.message}>{selection.tool ?? selection.message}</code></div>
    <nav className="inspector-tabs" aria-label={t('callInspector.sections')}>
      {sections.map(tab => <button key={tab} aria-pressed={section === tab} onClick={() => { setSection(tab); setLimit(65536); }}>
        {t(tab === 'response' && selection.tool ? 'callInspector.relatedResponse' : tab === 'raw' ? 'callInspector.records' : `callInspector.${tab}`)}
      </button>)}
    </nav>
    <div className="inspector-body">
      <div className="inspector-section-heading"><h3>{t(section === 'response' && selection.tool ? 'callInspector.relatedResponse' : section === 'raw' ? 'callInspector.records' : `callInspector.${section}`)}</h3>
        <button className="inspector-button" onClick={() => setRetry(n => n + 1)}>{t('callInspector.reload')}</button></div>
      <PayloadRequest key={`${url}:${retry}`} url={url} section={section} limit={limit} onMore={() => setLimit(n => Math.min(n * 4, 2_097_152))} />
    </div>
  </dialog>;
}
