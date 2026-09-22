// @vitest-environment jsdom
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  clearAudioCache, EDGE_CHROMIUM_VERSION, edgeSsml, parseEdgeMessage, secMsGec, sanitizeSpeechText,
  splitForSpeech, summarySpeechText, synthesizeCached, synthesizeSpeech,
  type SpeechSocket,
} from '../src/tts';
import { edgeSocketHeaders } from '../src/edge-socket';
import type { SummaryRecord } from '../src/model';

beforeAll(() => {
  Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  if (!window.crypto.randomUUID) Object.defineProperty(window.crypto, 'randomUUID', { value: randomUUID, configurable: true });
});

const record: SummaryRecord = {
  overview: '一段速览', bullets: ['要点一', '要点二'], core: '核心观点', evidence: ['论据一', '论据二'],
  conclusion: '结论', quotes: ['金句一', '金句二'], model: 'test', fetchedAt: 0,
};

describe('speech text selection', () => {
  it('reads exactly the style the reader is displaying', () => {
    expect(summarySpeechText(record, 'overview')).toBe('一段速览');
    expect(summarySpeechText(record, 'bullets')).toBe('要点一。要点二');
    expect(summarySpeechText(record, 'structure')).toBe('核心观点：核心观点。关键论据：论据一。论据二。结论：结论');
    expect(summarySpeechText(record, 'quotes')).toBe('金句一。金句二');
  });
  it('falls back to the overview when a style is empty', () => {
    const empty: SummaryRecord = { ...record, bullets: [], structure: undefined as never, quotes: [], core: '', evidence: [], conclusion: '' };
    expect(summarySpeechText(empty, 'bullets')).toBe('一段速览');
    expect(summarySpeechText(empty, 'quotes')).toBe('一段速览');
  });
});

describe('text sanitizing and splitting', () => {
  it('replaces control characters and collapses whitespace', () => {
    expect(sanitizeSpeechText('a\u000bb\u0001c\n\n  d')).toBe('a b c d');
  });
  it('splits long text on sentence boundaries within the limit', () => {
    const one = '短句。';
    expect(splitForSpeech(one)).toEqual(['短句。']);
    const long = '这是一句话。'.repeat(60);
    const segments = splitForSpeech(long, 100);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(Array.from(segment).length).toBeLessThanOrEqual(100);
    expect(segments.join('')).toBe(sanitizeSpeechText(long));
  });
  it('cuts a single oversized sentence on codepoint boundaries', () => {
    const segments = splitForSpeech('😀'.repeat(25), 10);
    expect(segments).toEqual(['😀'.repeat(10), '😀'.repeat(10), '😀'.repeat(5)]);
    expect(segments.join('')).toBe('😀'.repeat(25));
  });
  it('returns nothing for empty input', () => {
    expect(splitForSpeech('   \n  ')).toEqual([]);
  });
});

describe('SSML and Sec-MS-GEC', () => {
  it('escapes XML and applies voice, language and rate', () => {
    const ssml = edgeSsml('zh-CN-XiaoxiaoNeural', -20, 'a<b>&"c"');
    expect(ssml).toContain("name='zh-CN-XiaoxiaoNeural'");
    expect(ssml).toContain("xml:lang='zh-CN'");
    expect(ssml).toContain("rate='-20%'");
    expect(ssml).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(edgeSsml('en-US-AriaNeural', 0, 'hi')).toContain("xml:lang='en-US'");
  });
  it('derives the token from the current five-minute window', async () => {
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);
    let ticks = now / 1000 + 11644473600;
    ticks -= ticks % 300;
    const expected = createHash('sha256').update(`${Math.floor(ticks * 1e7)}6A5AA1D4EAFF4E9FB37E23D68491D6F4`).digest('hex').toUpperCase();
    expect(await secMsGec(now)).toBe(expected);
    expect(await secMsGec(now)).toHaveLength(64);
  });
});

describe('WebSocket frame parsing', () => {
  it('separates audio payloads from the header and detects turn end', () => {
    const header = new TextEncoder().encode('X-RequestId:x\r\nPath:audio\r\n');
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = new Uint8Array(2 + header.length + payload.length);
    frame[0] = (header.length >> 8) & 0xff; frame[1] = header.length & 0xff;
    frame.set(header, 2); frame.set(payload, 2 + header.length);
    const parsed = parseEdgeMessage(frame.buffer as ArrayBuffer);
    expect(parsed.kind).toBe('audio');
    if (parsed.kind === 'audio') expect(Array.from(parsed.payload)).toEqual([1, 2, 3, 4]);
    expect(parseEdgeMessage('X-RequestId:x\r\nPath:turn.end')).toEqual({ kind: 'turnEnd' });
    expect(parseEdgeMessage('Path:response')).toEqual({ kind: 'other', text: 'Path:response' });
  });
});

class FakeSocket implements SpeechSocket {
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
}

function audioFrame(bytes: number[]): ArrayBuffer {
  const header = new TextEncoder().encode('Path:audio\r\n');
  const out = new Uint8Array(2 + header.length + bytes.length);
  out[0] = (header.length >> 8) & 0xff; out[1] = header.length & 0xff;
  out.set(header, 2); out.set(new Uint8Array(bytes), 2 + header.length);
  return out.buffer as ArrayBuffer;
}

describe('Edge speech synthesis', () => {
  it('sends the config and SSML then resolves the concatenated audio', async () => {
    let socket: FakeSocket | undefined;
    const promise = synthesizeSpeech({ text: '你好。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0, createSocket: () => (socket = new FakeSocket()) });
    await vi.waitFor(() => expect(socket).toBeDefined());
    socket!.onopen?.();
    expect(socket!.sent[0]).toContain('Path:speech.config');
    expect(socket!.sent[0]).toContain('audio-24khz-48kbitrate-mono-mp3');
    expect(socket!.sent[1]).toContain('Path:ssml');
    expect(socket!.sent[1]).toContain('你好。');
    socket!.onmessage?.({ data: audioFrame([1, 2]) });
    socket!.onmessage?.({ data: audioFrame([3]) });
    socket!.onmessage?.({ data: 'Path:turn.end' });
    const blob = await promise;
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe(3);
    expect(socket!.closed).toBe(true);
  });
  it('rejects when the socket closes before returning audio', async () => {
    let socket: FakeSocket | undefined;
    const promise = synthesizeSpeech({ text: '你好。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0, createSocket: () => (socket = new FakeSocket()) });
    await vi.waitFor(() => expect(socket).toBeDefined());
    socket!.onopen?.();
    socket!.onclose?.({ code: 1006 });
    await expect(promise).rejects.toThrow('断开');
  });
  it('rejects on a connection error and on timeout', async () => {
    let socket: FakeSocket | undefined;
    const failing = synthesizeSpeech({ text: '你好。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0, createSocket: () => (socket = new FakeSocket()) });
    await vi.waitFor(() => expect(socket).toBeDefined());
    socket!.onerror?.(new Error('blocked'));
    await expect(failing).rejects.toThrow('Edge 语音服务');
    await expect(synthesizeSpeech({ text: '你好。', voice: 'zh-CN-XiaoxiaoNeural', rate: 0, timeoutMs: 20, createSocket: () => new FakeSocket() })).rejects.toThrow('超时');
  });
  it('refuses empty speech input', async () => {
    await expect(synthesizeSpeech({ text: '   ', voice: 'zh-CN-XiaoxiaoNeural', rate: 0, createSocket: () => new FakeSocket() })).rejects.toThrow('没有可朗读');
  });
});

describe('Edge voice reuse', () => {
  it('reuses synthesized audio for the same text, voice and rate', async () => {
    clearAudioCache();
    const socket = () => new FakeSocket();
    const synthesize = vi.fn(async () => new Blob(['audio'], { type: 'audio/mpeg' }));
    await synthesizeCached('缓存测试。', 'zh-CN-XiaoxiaoNeural', 0, socket, synthesize);
    await synthesizeCached('缓存测试。', 'zh-CN-XiaoxiaoNeural', 0, socket, synthesize);
    expect(synthesize).toHaveBeenCalledTimes(1);
    await synthesizeCached('缓存测试。', 'zh-CN-XiaoxiaoNeural', 20, socket, synthesize);
    await synthesizeCached('另一段。', 'zh-CN-XiaoxiaoNeural', 0, socket, synthesize);
    expect(synthesize).toHaveBeenCalledTimes(3);
    clearAudioCache();
  });
  it('does not cache a failed synthesis', async () => {
    clearAudioCache();
    const socket = () => new FakeSocket();
    const synthesize = vi.fn()
      .mockRejectedValueOnce(new Error('Edge 语音服务没有返回音频。'))
      .mockResolvedValueOnce(new Blob(['audio'], { type: 'audio/mpeg' }));
    await expect(synthesizeCached('重试。', 'zh-CN-XiaoxiaoNeural', 0, socket, synthesize)).rejects.toThrow('没有返回音频');
    await expect(synthesizeCached('重试。', 'zh-CN-XiaoxiaoNeural', 0, socket, synthesize)).resolves.toBeInstanceOf(Blob);
    expect(synthesize).toHaveBeenCalledTimes(2);
    clearAudioCache();
  });
});

describe('Edge transport headers', () => {
  it('sends an Edge user agent, because anything else is rejected with HTTP 403', () => {
    const headers = edgeSocketHeaders();
    expect(headers['User-Agent']).toContain('Edg/');
    expect(headers['User-Agent']).toContain(EDGE_CHROMIUM_VERSION.split('.')[0]);
    expect(headers.Origin).toBe('chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
    expect(headers['User-Agent']).not.toContain('obsidian');
    expect(headers['User-Agent']).not.toContain('Electron');
  });
});
