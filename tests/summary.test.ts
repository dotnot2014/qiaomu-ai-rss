// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_SUMMARY_INPUT, parseSummaryPayload, requestSummary, summaryEndpoint, truncateForSummary, type SummaryRequest } from '../src/summary';

const content = (value: string) => JSON.stringify({ choices: [{ message: { content: value } }] });

describe('OpenAI-compatible endpoint resolution', () => {
  it('appends the chat-completions path to a base URL', () => {
    expect(summaryEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
    expect(summaryEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(summaryEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(summaryEndpoint('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
  });
  it('keeps an explicit completions path and rejects unsafe addresses', () => {
    expect(summaryEndpoint('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/chat/completions');
    for (const value of ['', '   ', 'ftp://example.com', 'https://user:secret@example.com', 'https://example.com/v1?token=1', 'not a url']) {
      expect(() => summaryEndpoint(value)).toThrow();
    }
  });
});

describe('summary input bounds', () => {
  it('normalizes whitespace and only truncates when needed', () => {
    expect(truncateForSummary('a\r\n\r\n\r\n\r\nb')).toEqual({ text: 'a\n\nb', truncated: false });
    const long = truncateForSummary('字'.repeat(MAX_SUMMARY_INPUT + 50));
    expect(long.truncated).toBe(true);
    expect(Array.from(long.text)).toHaveLength(MAX_SUMMARY_INPUT);
  });
  it('never splits a surrogate pair', () => {
    const result = truncateForSummary('😀'.repeat(MAX_SUMMARY_INPUT + 5));
    expect(result.text.endsWith('😀')).toBe(true);
  });
});

describe('defensive summary parsing', () => {
  it('reads plain, fenced and prose-wrapped JSON', () => {
    const body = { overview: '速览', bullets: ['一', '二'], core: '核心', evidence: ['证据'], conclusion: '结论', quotes: ['金句'] };
    for (const raw of [JSON.stringify(body), '```json\n' + JSON.stringify(body) + '\n```', `好的，结果如下：\n${JSON.stringify(body)}\n以上。`]) {
      expect(parseSummaryPayload(raw)).toEqual(body);
    }
  });
  it('falls back to plain text and drops unusable list items', () => {
    expect(parseSummaryPayload('模型直接输出了一段话')).toEqual({ overview: '模型直接输出了一段话', bullets: [], core: '', evidence: [], conclusion: '', quotes: [] });
    expect(parseSummaryPayload('{ broken').overview).toBe('{ broken');
    const mixed = parseSummaryPayload(JSON.stringify({ overview: 1, bullets: ['ok', null, '  ', 'two'], core: 'x' }));
    expect(mixed.overview).toBe(''); expect(mixed.bullets).toEqual(['ok', 'two']); expect(mixed.core).toBe('x');
  });
});

describe('summary request contract', () => {
  const base = { endpoint: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model', title: '标题', text: '正文内容' };

  it('posts a chat-completions request and parses the result', async () => {
    const transport = vi.fn(async () => ({ status: 200, text: content(JSON.stringify({ overview: '一句话', bullets: [] })) }));
    const result = await requestSummary({ ...base, transport });
    expect(result.overview).toBe('一句话');
    const request = transport.mock.calls[0][0] as SummaryRequest;
    expect(request.url).toBe('https://api.example.com/v1/chat/completions');
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(request.body) as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('test-model');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('标题');
    expect(body.messages[1].content).toContain('正文内容');
  });
  it('omits authorization for keyless local endpoints and accepts content parts', async () => {
    const transport = vi.fn(async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '本地结果' }] } }] }) }));
    const result = await requestSummary({ ...base, apiKey: '', endpoint: 'http://localhost:11434/v1', transport });
    expect(result.overview).toBe('本地结果');
    expect((transport.mock.calls[0][0] as SummaryRequest).headers.Authorization).toBeUndefined();
  });
  it('surfaces HTTP status and rejects unusable payloads', async () => {
    await expect(requestSummary({ ...base, transport: async () => ({ status: 401, text: '{"error":"bad key"}' }) })).rejects.toThrow('HTTP 401');
    await expect(requestSummary({ ...base, transport: async () => ({ status: 200, text: '<html>' }) })).rejects.toThrow('有效 JSON');
    await expect(requestSummary({ ...base, transport: async () => ({ status: 200, text: '{"choices":[]}' }) })).rejects.toThrow('可用结果');
    await expect(requestSummary({ ...base, model: '  ', transport: async () => ({ status: 200, text: content('{}') }) })).rejects.toThrow('模型名称');
    await expect(requestSummary({ ...base, text: '   ', transport: async () => ({ status: 200, text: content('{}') }) })).rejects.toThrow('正文');
  });
  it('times out stalled requests', async () => {
    vi.useFakeTimers();
    const assertion = expect(requestSummary({ ...base, transport: () => new Promise(() => {}) })).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(60001);
    await assertion;
    vi.useRealTimers();
  });
});
