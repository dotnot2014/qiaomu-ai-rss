// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { audioUrl, renderMedia, stopMedia, youtubeEmbedUrl } from '../src/media';
import { initialState, type Entry } from '../src/model';

const entry: Entry = { id: 'episode', sourceId: 'podcast', title: 'Episode' };
describe('media data and source safety', () => {
  it('retains remote audio through API parsing and persisted state', async () => {
    const audio = { url: 'https://media.example/episode.m4a', type: 'audio/mp4' };
    const transport = vi.fn(async () => ({ status: 200, text: JSON.stringify({ entries: [{ ...entry, audio }], hasMore: false }) }));
    const result = await new RssApi('https://rss.qiaomu.ai', transport).entries('podcast');
    expect(result.entries[0].audio).toEqual(audio);
    expect(transport.mock.calls[0][0]).not.toContain('ready=rewrite');
    const state = initialState({ entries: result.entries });
    expect(initialState(JSON.parse(JSON.stringify(state))).entries[0].audio).toEqual(audio);
  });
  it('accepts only HTTPS audio with audio MIME and no credentials', () => {
    expect(audioUrl({ ...entry, audio: { url: 'https://media.example/a.mp3', type: 'audio/mpeg' } })).toBe('https://media.example/a.mp3');
    for (const url of ['javascript:alert(1)', 'http://media.example/a.mp3', 'https://user:pass@media.example/a.mp3']) {
      expect(audioUrl({ ...entry, audio: { url, type: 'audio/mpeg' } })).toBeNull();
    }
    expect(audioUrl({ ...entry, audio: { url: 'https://example.com/payload', type: 'text/html' } })).toBeNull();
  });
  it('accepts canonical YouTube IDs but not lookalike hosts or arbitrary paths', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=JtomF4bGxHs&t=90')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    expect(youtubeEmbedUrl('https://youtu.be/JtomF4bGxHs')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    expect(youtubeEmbedUrl('https://m.youtube.com/shorts/JtomF4bGxHs')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    for (const url of ['https://youtube.com.evil.test/watch?v=JtomF4bGxHs', 'https://www.youtube.com/@account', 'http://www.youtube.com/watch?v=JtomF4bGxHs', 'https://www.youtube.com/watch?v=bad']) expect(youtubeEmbedUrl(url)).toBeNull();
  });
  it('shows the YouTube player preview immediately without autoplay or extra copy', () => {
    const article = document.createElement('article');
    const createEl = function (this: HTMLElement, tag: keyof HTMLElementTagNameMap, options?: { cls?: string; attr?: Record<string, string> }) {
      const child = document.createElement(tag);
      if (options?.cls) child.className = options.cls;
      for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
      Object.assign(child, { createEl });
      this.append(child);
      return child;
    };
    Object.assign(article, { createEl });

    renderMedia(article, { ...entry, link: 'https://www.youtube.com/watch?v=JtomF4bGxHs' });

    const frame = article.querySelector('iframe.qrs-video-frame');
    expect(frame?.getAttribute('src')).toBe('https://www.youtube.com/embed/JtomF4bGxHs?autoplay=0&playsinline=1');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation allow-popups');
    expect(frame?.getAttribute('title')).toBe('视频播放器');
    expect(article.querySelector('button, p')).toBeNull();
  });
  it('stops removed audio and unloads an embedded frame on article switch', () => {
    const root = document.createElement('div');
    root.innerHTML = '<audio src="https://media.example/a.mp3"></audio><iframe class="qrs-video-frame" src="https://www.youtube.com/embed/JtomF4bGxHs"></iframe>';
    const audio = root.querySelector('audio')!;
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(audio, 'load').mockImplementation(() => undefined);
    stopMedia(root);
    expect(pause).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledOnce();
    expect(audio.hasAttribute('src')).toBe(false);
    expect(root.querySelector('iframe')?.hasAttribute('src')).toBe(false);
  });
});
