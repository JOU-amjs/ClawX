import { createHostEventSource } from './host-api';

let eventSource: EventSource | null = null;
let eventSourcePromise: Promise<EventSource> | null = null;

const HOST_EVENT_TO_IPC_CHANNEL: Record<string, string> = {
  'gateway:status': 'gateway:status-changed',
  'gateway:error': 'gateway:error',
  'gateway:notification': 'gateway:notification',
  'gateway:chat-message': 'gateway:chat-message',
  'gateway:channel-status': 'gateway:channel-status',
  'gateway:exit': 'gateway:exit',
  'oauth:code': 'oauth:code',
  'oauth:success': 'oauth:success',
  'oauth:error': 'oauth:error',
  'channel:whatsapp-qr': 'channel:whatsapp-qr',
  'channel:whatsapp-success': 'channel:whatsapp-success',
  'channel:whatsapp-error': 'channel:whatsapp-error',
  'channel:wechat-qr': 'channel:wechat-qr',
  'channel:wechat-success': 'channel:wechat-success',
  'channel:wechat-error': 'channel:wechat-error',
};

function getEventSource(): Promise<EventSource> {
  if (eventSource) return Promise.resolve(eventSource);
  if (!eventSourcePromise) {
    eventSourcePromise = createHostEventSource().then((source) => {
      eventSource = source;
      return source;
    });
  }
  return eventSourcePromise;
}

function allowSseFallback(): boolean {
  try {
    return window.localStorage.getItem('clawx:allow-sse-fallback') === '1';
  } catch {
    return false;
  }
}

export function subscribeHostEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
): () => void {
  const ipc = window.electron?.ipcRenderer;
  const ipcChannel = HOST_EVENT_TO_IPC_CHANNEL[eventName];
  if (ipcChannel && ipc?.on && ipc?.off) {
    const listener = (payload: unknown) => {
      handler(payload as T);
    };
    ipc.on(ipcChannel, listener);
    return () => {
      ipc.off(ipcChannel, listener);
    };
  }

  if (!allowSseFallback()) {
    console.warn(`[host-events] no IPC mapping for event "${eventName}", SSE fallback disabled`);
    return () => {};
  }

  const listener = (event: Event) => {
    const payload = JSON.parse((event as MessageEvent).data) as T;
    handler(payload);
  };
  let unsubscribed = false;
  void getEventSource().then((source) => {
    if (unsubscribed) return;
    source.addEventListener(eventName, listener);
  });
  return () => {
    unsubscribed = true;
    // If the EventSource was already resolved, remove the listener immediately.
    if (eventSource) {
      eventSource.removeEventListener(eventName, listener);
    }
  };
}
