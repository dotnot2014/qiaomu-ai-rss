/* global require -- `ws` must load lazily so its Node built-ins never run on mobile. */
import { Platform } from 'obsidian';
import { EDGE_ORIGIN, EDGE_USER_AGENT, type SpeechSocket } from './tts';

/**
 * Microsoft's speech endpoint returns HTTP 403 unless the request carries a real Edge User-Agent,
 * and a page-level WebSocket cannot override its browser-controlled User-Agent or Origin.
 * The socket is therefore opened from Node through `ws`, which accepts both.
 *
 * `ws` resolves to its browser stub by default, so the build aliases it to the Node entry
 * (see esbuild.config.mjs). It is required lazily because its module body pulls in Node
 * built-ins, which must never run on mobile. Platform.isDesktop gates the only entry point.
 */

export function edgeSocketHeaders(): Record<string, string> {
  return {
    'User-Agent': EDGE_USER_AGENT,
    Origin: EDGE_ORIGIN,
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

type WsConstructor = new (url: string, options: Record<string, unknown>) => unknown;
let cached: WsConstructor | undefined;

function loadWebSocket(): WsConstructor {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy so ws's Node built-ins never load on mobile
  const loaded: unknown = require('ws');
  const candidate = typeof loaded === 'function' ? loaded : (loaded as { default?: unknown })?.default;
  if (typeof candidate !== 'function') throw new Error('语音组件未能加载，请重新安装插件。');
  cached = candidate as WsConstructor;
  return cached;
}

export function createEdgeSocket(url: string): SpeechSocket {
  if (!Platform.isDesktop) throw new Error('语音朗读目前仅支持桌面端 Obsidian。');
  const WebSocketImpl = loadWebSocket();
  return new WebSocketImpl(url, { headers: edgeSocketHeaders() }) as SpeechSocket;
}
