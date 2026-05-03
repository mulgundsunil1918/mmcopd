/**
 * Renderer-side WebSocket client for the multi-station setup.
 *
 * In Client mode this connects to ws://<server>/ws and listens for events the
 * main process broadcasts after every relevant write (new appointment, status
 * change, etc.). On each event we invalidate the matching react-query cache key
 * so any open page refetches and the user sees the change in real time
 * without polling.
 *
 * We also expose a small connection-status observable so the sidebar pill /
 * top-of-screen banner can show "Connected · 2 cabins" or
 * "Reconnecting in 3s…" when the LAN drops.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const EVENT_TO_KEYS: Record<string, string[][]> = {
  // Both reception + cabin appointment lists, plus the badge counters.
  'appointment:new':    [['appointments'], ['stats', 'today'], ['analytics-overview']],
  'appointment:status': [['appointments'], ['stats', 'today']],
  'appointment:deleted':[['appointments'], ['stats', 'today']],
  'patient:new':        [['patients'], ['patient-search-modal'], ['analytics-overview']],
  'consultation:saved': [['consultation'], ['rx']],
  'bill:created':       [['bills'], ['analytics-overview'], ['finance-summary']],
  'pharmacy:dispensed': [['pharmacy-sales'], ['pharmacy-alerts']],
  'pharmacy:sale':      [['pharmacy-sales-month'], ['analytics-overview']],
};

export function useNetworkLive() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [serverInfo, setServerInfo] = useState<{ version?: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const closedByCallerRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      // Read live status to find the right URL + secret.
      let mode = 'local', serverUrl = '', secret = '';
      try {
        const s = await window.electronAPI.network.status();
        mode = s.mode;
        serverUrl = s.serverUrl;
        secret = '';  // secret isn't returned over IPC for safety; we read from localStorage mirror
        try { secret = localStorage.getItem('caredesk:network-secret') || ''; } catch { /* ignore */ }
      } catch {
        setStatus('idle');
        return;
      }
      if (mode !== 'client' || !serverUrl) {
        setStatus('idle');
        return;
      }
      const wsUrl = serverUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws' + (secret ? `?token=${encodeURIComponent(secret)}` : '');
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setStatus('error');
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => { if (!cancelled) setStatus('connected'); };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data?.event === 'hello') {
            setServerInfo(data.payload || null);
            return;
          }
          const keys = EVENT_TO_KEYS[data?.event];
          if (keys) {
            for (const k of keys) qc.invalidateQueries({ queryKey: k });
          }
        } catch { /* ignore malformed */ }
      };
      ws.onerror = () => { if (!cancelled) setStatus('error'); };
      ws.onclose = () => {
        if (cancelled) return;
        if (closedByCallerRef.current) {
          setStatus('idle');
          closedByCallerRef.current = false;
          return;
        }
        setStatus('disconnected');
        scheduleReconnect();
      };
    };
    const scheduleReconnect = () => {
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(() => { if (!cancelled) connect(); }, 5_000);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      closedByCallerRef.current = true;
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, serverInfo };
}
