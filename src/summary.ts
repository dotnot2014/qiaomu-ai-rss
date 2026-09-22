import { z } from 'zod';

export const MAX_SUMMARY_INPUT = 12_000;
export const SUMMARY_TIMEOUT_MS = 60_000;

export interface SummaryResponse { status: number; text: string }
export interface SummaryRequest { url: string; method: 'POST'; headers: Record<string, string>; body: string }
export type SummaryTransport = (request: SummaryRequest) => Promise<SummaryResponse>;

/** Resolves an OpenAI-compatible base URL into its chat-completions endpoint. */
export function summaryEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请先填写 AI 接口地址。');
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error('AI 接口地址无效，请填写完整的 http(s) 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('AI 接口地址必须是 http(s)，且不包含账号、查询参数或锚点。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  return path.endsWith('/chat/completions') ? `${url.origin}${path}` : `${url.origin}${path}/chat/completions`;
}

/** Codepoint-safe truncation so a long article cannot exceed the request budget. */
export function truncateForSummary(text: string, max = MAX_SUMMARY_INPUT): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const points = Array.from(normalized);
  if (points.length <= max) return { text: normalized, truncated: false };
  return { text: points.slice(0, max).join(''), truncated: true };
}

const summaryBodySchema = z.object({
  overview: z.string(), bullets: z.array(z.string()), core: z.string(),
  evidence: z.array(z.string()), conclusion: z.string(), quotes: z.array(z.string()),
});
export type SummaryBody = z.infer<typeof summaryBodySchema>;

const empty = (overview = ''): SummaryBody => ({ overview, bullets: [], core: '', evidence: [], conclusion: '', quotes: [] });

/** Models sometimes wrap JSON in prose or code fences; keep a plain-text fallback. */
export function parseSummaryPayload(raw: string): SummaryBody {
  const value = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = value.indexOf('{'), end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return empty(value);
  let data: unknown;
  try { data = JSON.parse(value.slice(start, end + 1)); }
  catch { return empty(value); }
  if (!data || typeof data !== 'object') return empty(value);
  const record = data as Record<string, unknown>;
  const text = (input: unknown) => typeof input === 'string' ? input.trim() : '';
  const list = (input: unknown) => Array.isArray(input) ? input.map(text).filter(Boolean).slice(0, 8) : [];
  const parsed = summaryBodySchema.safeParse({
    overview: text(record.overview), bullets: list(record.bullets), core: text(record.core),
    evidence: list(record.evidence), conclusion: text(record.conclusion), quotes: list(record.quotes),
  });
  if (parsed.success) return parsed.data;
  return empty(value);
}

function messageContent(raw: string): string {
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new Error('AI 接口返回的不是有效 JSON。'); }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) throw new Error('AI 接口没有返回可用结果。');
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === 'string') return content;
  // Newer OpenAI-compatible payloads may return content parts.
  if (Array.isArray(content)) return content.map(part => typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '').join('');
  throw new Error('AI 接口没有返回可用结果。');
}

const systemPrompt = [
  '你是一名中文编辑。阅读用户提供的文章正文，只输出一个 JSON 对象，不要输出解释、前言或 Markdown 代码围栏。',
  'JSON 结构：{"overview":"一段话速览，120 字以内","bullets":["3 到 7 条要点"],"core":"核心观点，一句话","evidence":["2 到 4 条关键论据"],"conclusion":"结论，一句话","quotes":["2 到 4 句原文中值得摘录的原句"]}',
  '所有字段用中文填写；人名、产品名、代码和专有名词保留原文。信息不足的字段留空字符串或空数组，不要编造。',
].join('\n');

export interface SummarizeOptions {
  endpoint: string; apiKey: string; model: string; title: string; text: string; transport: SummaryTransport;
}

export async function requestSummary(options: SummarizeOptions): Promise<SummaryBody> {
  const url = summaryEndpoint(options.endpoint);
  const model = options.model.trim();
  if (!model) throw new Error('请先填写模型名称。');
  const { text } = truncateForSummary(options.text);
  if (!text) throw new Error('这篇文章没有可总结的正文。');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey.trim()) headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `《${options.title.trim() || '未命名文章'}》\n\n${text}` }],
    temperature: 0.2,
  });
  let timer: number | undefined;
  let response: SummaryResponse;
  try {
    response = await Promise.race([
      options.transport({ url, method: 'POST', headers, body }),
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('AI 总结请求超时，请重试。')), SUMMARY_TIMEOUT_MS); }),
    ]);
  } finally { window.clearTimeout(timer); }
  if (response.status < 200 || response.status >= 300) {
    // Error bodies explain a wrong key or model; never echo the request or its headers.
    const detail = response.text.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`AI 接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return parseSummaryPayload(messageContent(response.text));
}
