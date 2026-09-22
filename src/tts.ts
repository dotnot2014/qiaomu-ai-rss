import type { SummaryRecord, SummaryStyle } from './model';

/**
 * Edge "Read Aloud" online voices. The endpoint is a WebSocket service that needs no API key,
 * but it rejects requests whose Sec-MS-GEC token is built from an outdated Chromium version.
 * Bump EDGE_CHROMIUM_VERSION when Microsoft rotates the requirement (edge-tts uses the same value).
 */
export const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const EDGE_CHROMIUM_VERSION = '143.0.3650.75';
export const EDGE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
export const TTS_TIMEOUT_MS = 30_000;
export const TTS_SEGMENT_CHARS = 1_000;

export interface TtsVoice { id: string; name: string }
export const ttsVoices: TtsVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 · 女声（默认）' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 · 女声' },
  { id: 'zh-CN-YunxiNeural', name: '云希 · 男声' },
  { id: 'zh-CN-YunjianNeural', name: '云健 · 男声（解说）' },
  { id: 'zh-CN-YunyangNeural', name: '云扬 · 男声（新闻）' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北 · 东北话' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮 · 陕西话' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼 · 粤语' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻 · 台湾国语' },
  { id: 'en-US-AriaNeural', name: 'Aria · English (US)' },
  { id: 'en-US-GuyNeural', name: 'Guy · English (US)' },
];

/** Text the speaker button reads for the currently displayed summary style. */
export function summarySpeechText(record: SummaryRecord, style: SummaryStyle): string {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  if (style === 'overview') return clean(record.overview || record.core);
  if (style === 'bullets') return clean(record.bullets.length ? record.bullets.join('。') : record.overview);
  if (style === 'structure') {
    return clean([
      record.core ? `核心观点：${record.core}` : '',
      record.evidence.length ? `关键论据：${record.evidence.join('。')}` : '',
      record.conclusion ? `结论：${record.conclusion}` : '',
    ].filter(Boolean).join('。') || record.overview);
  }
  return clean(record.quotes.length ? record.quotes.join('。') : record.overview);
}

/** The service rejects a few control characters, notably the vertical tab common in clipped PDFs. */
export function sanitizeSpeechText(value: string): string {
  return Array.from(value).map(char => {
    const code = char.codePointAt(0) ?? 0;
    const control = code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31);
    return control ? ' ' : char;
  }).join('').replace(/\s+/g, ' ').trim();
}

/** Sentence-ish chunks without lookbehind, which older iOS WebViews cannot parse. */
function splitSentences(value: string): string[] {
  const points = Array.from(value);
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    current += point;
    const boundary = '。！？!?；;\n'.includes(point) || (point === '.' && (index + 1 >= points.length || points[index + 1] === ' '));
    if (boundary) { result.push(current); current = ''; }
  }
  if (current) result.push(current);
  return result;
}

/** Splits long summaries into separate requests at sentence boundaries. */
export function splitForSpeech(text: string, max = TTS_SEGMENT_CHARS): string[] {
  const normalized = sanitizeSpeechText(text);
  if (!normalized) return [];
  const parts = splitSentences(normalized).map(part => part.trim()).filter(Boolean);
  const segments: string[] = [];
  let current = '';
  for (const part of parts) {
    if (Array.from(current + part).length <= max) { current += part; continue; }
    if (current) segments.push(current);
    if (Array.from(part).length <= max) { current = part; continue; }
    // A single sentence longer than the limit: cut on codepoint boundaries.
    const points = Array.from(part);
    for (let index = 0; index < points.length; index += max) segments.push(points.slice(index, index + max).join(''));
    current = '';
  }
  if (current) segments.push(current);
  return segments;
}

export function escapeSsml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function edgeSsml(voice: string, rate: number, text: string): string {
  const percent = `${rate >= 0 ? '+' : ''}${Math.round(rate)}%`;
  const lang = voice.startsWith('en-') ? 'en-US' : voice.startsWith('zh-HK') ? 'zh-HK' : voice.startsWith('zh-TW') ? 'zh-TW' : 'zh-CN';
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>`
    + `<voice name='${escapeSsml(voice)}'><prosody pitch='+0Hz' rate='${percent}' volume='+0%'>${escapeSsml(text)}</prosody></voice></speak>`;
}

export function edgeConfigMessage(): string {
  const body = JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: EDGE_OUTPUT_FORMAT } } } });
  return `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${body}`;
}

export function edgeSsmlMessage(connectionId: string, voice: string, rate: number, text: string): string {
  return `X-RequestId:${connectionId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n${edgeSsml(voice, rate, text)}`;
}

/** Sec-MS-GEC: SHA-256 of the 5-minute Windows file-time window plus the trusted token. */
export async function secMsGec(now: number): Promise<string> {
  const WIN_EPOCH = 11_644_473_600;
  let ticks = now / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${Math.floor(ticks * 1e7)}${EDGE_TRUSTED_TOKEN}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function edgeSocketUrl(gec: string, connectionId: string): string {
  return 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    + `?TrustedClientToken=${EDGE_TRUSTED_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VERSION}&ConnectionId=${connectionId}`;
}

export type EdgeFrame = { kind: 'audio'; payload: Uint8Array } | { kind: 'turnEnd' } | { kind: 'other'; text: string };

/** Binary frames carry a 2-byte big-endian header length, a header, then MP3 bytes. */
export function parseEdgeMessage(data: string | ArrayBuffer): EdgeFrame {
  if (typeof data === 'string') return data.includes('Path:turn.end') ? { kind: 'turnEnd' } : { kind: 'other', text: data };
  const bytes = new Uint8Array(data);
  if (bytes.byteLength < 2) return { kind: 'other', text: '' };
  const headerLength = (bytes[0] << 8) | bytes[1];
  const header = new TextDecoder().decode(bytes.subarray(2, 2 + headerLength));
  return header.includes('Path:audio') ? { kind: 'audio', payload: bytes.subarray(2 + headerLength) } : { kind: 'other', text: header };
}

export interface SpeechSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface SynthesizeOptions {
  text: string; voice: string; rate: number;
  createSocket?: (url: string) => SpeechSocket;
  timeoutMs?: number;
}

function synthesizeSegment(options: SynthesizeOptions & { text: string }): Promise<Blob> {
  const connectionId = window.crypto.randomUUID().replace(/-/g, '');
  const createSocket = options.createSocket ?? (url => new WebSocket(url) as unknown as SpeechSocket);
  return secMsGec(Date.now()).then(gec => new Promise<Blob>((resolve, reject) => {
    const socket = createSocket(edgeSocketUrl(gec, connectionId));
    socket.binaryType = 'arraybuffer';
    const chunks: Uint8Array[] = [];
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('语音合成超时，请重试。')), options.timeoutMs ?? TTS_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; window.clearTimeout(timer);
      try { socket.close(); } catch { /* already closing */ }
      if (error) reject(error);
      else resolve(new Blob(chunks, { type: 'audio/mpeg' }));
    };
    socket.onerror = () => finish(new Error('无法连接 Edge 语音服务。请检查网络或代理；若持续失败，可能是语音请求版本已过期。'));
    socket.onclose = event => {
      if (settled) return;
      finish(chunks.length ? undefined : new Error(`Edge 语音服务在返回音频前断开（${event?.code ?? '未知'}）。`));
    };
    socket.onopen = () => {
      socket.send(edgeConfigMessage());
      socket.send(edgeSsmlMessage(connectionId, options.voice, options.rate, options.text));
    };
    socket.onmessage = event => {
      const frame = parseEdgeMessage(event.data);
      if (frame.kind === 'audio') chunks.push(frame.payload);
      else if (frame.kind === 'turnEnd') finish(chunks.length ? undefined : new Error('Edge 语音服务没有返回音频。'));
    };
  }));
}

/** Synthesizes one MP3 blob; long text is split into sequential requests and concatenated. */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<Blob> {
  const segments = splitForSpeech(options.text);
  if (!segments.length) throw new Error('没有可朗读的内容。');
  const blobs: Blob[] = [];
  for (const text of segments) blobs.push(await synthesizeSegment({ ...options, text }));
  return new Blob(blobs, { type: 'audio/mpeg' });
}

/* -------------------------------------------------------------------------------------------
 * Playback cache
 * Edge is the only engine: the device voices are not good enough to be a fallback, so a failed
 * request surfaces its real error instead of silently degrading. Replaying the same summary,
 * voice and rate reuses the synthesized audio.
 * ---------------------------------------------------------------------------------------- */

const audioCache = new Map<string, Blob>();
const AUDIO_CACHE_LIMIT = 20;

export function clearAudioCache() { audioCache.clear(); }

/** Replays of the same summary, voice and rate reuse the synthesized audio. */
export async function synthesizeCached(text: string, voice: string, rate: number, synthesize = synthesizeSpeech): Promise<Blob> {
  const key = `${voice}|${rate}|${text}`;
  const cached = audioCache.get(key);
  if (cached) return cached;
  const blob = await synthesize({ text, voice, rate });
  if (audioCache.size >= AUDIO_CACHE_LIMIT) { const [oldest] = audioCache.keys(); if (oldest !== undefined) audioCache.delete(oldest); }
  audioCache.set(key, blob);
  return blob;
}
