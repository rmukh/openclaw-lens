interface LiveMessage {
  type?: string;
}

/** Own one live connection and its retry timer for a React effect. */
export function connectLiveSocket({ onMessage, onConnectionChange }: {
  onMessage: (message: LiveMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
}): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout>;

  function connect() {
    if (stopped) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = socket = new WebSocket(`${proto}://${window.location.host}/ws/live`);
    ws.onopen = () => {
      // An effect can be removed while the handshake is still in flight.
      // Finish it before closing, rather than aborting the TCP connection.
      if (stopped) ws.close();
      else onConnectionChange?.(true);
    };
    ws.onmessage = event => {
      if (stopped) return;
      try { onMessage(JSON.parse(event.data as string) as LiveMessage); }
      catch { /* Ignore malformed live events. */ }
    };
    ws.onclose = () => {
      if (stopped) return;
      onConnectionChange?.(false);
      timer = setTimeout(connect, 3000);
    };
    ws.onerror = () => {}; // The subsequent close event schedules the retry.
  }

  // React StrictMode runs setup/cleanup/setup synchronously in development.
  // Let its first cleanup cancel the connection before opening a socket.
  timer = setTimeout(connect, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN) socket.close();
    // CONNECTING sockets close in onopen; closing now aborts their handshake.
  };
}
