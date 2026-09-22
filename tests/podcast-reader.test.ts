// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RssApi } from '../src/api';
import { podcastRecommendations } from '../src/discovery';
import { initialState, podcastDefaultMode } from '../src/model';

const id = 'episode-1';
const entry = { id, sourceId: 'podscribe-acquired', title: 'Episode', content: '<p>Only a short summary</p>' };
const response = (value: unknown) => ({ status: 200, text: JSON.stringify(value) });

describe('QMReader podcast integration', () => {
  it('requests only the latest entry when filling the default curated feed', async () => {
    let requested = '';
    const api = new RssApi('https://rss.qiaomu.ai', async url => { requested = url; return response({ entries: [{ id: 'latest', sourceId: 'nexttoken', title: 'Latest' }] }); });
    const page = await api.entries('nexttoken', '', 1);
    expect(requested).toBe('https://rss.qiaomu.ai/api/sources/nexttoken/entries?limit=1');
    expect(page.entries).toHaveLength(1);
  });
  it('keeps the website curated order and migrates followed shows', () => {
    expect(podcastRecommendations.map(show => show.name)).toEqual([
      'Lex Fridman Podcast', 'All-In Podcast', 'Acquired', 'Pivot', 'Invest Like the Best',
      'Masters of Scale', 'The Diary Of A CEO', 'The Prof G Pod', 'Freakonomics Radio', 'The Joe Rogan Experience',
    ]);
    expect(podcastRecommendations.find(show => show.name === 'All-In Podcast')?.sourceId).toBe('podscribe-all-in-with-chamath-jason-sacks-friedberg');
    expect(podcastRecommendations.find(show => show.name === 'The Joe Rogan Experience')?.sourceId).toBe('podscribe-the-joe-rogan-experience');
    expect(initialState({}).settings.followedPodcasts).toEqual([]);
    expect(initialState({ settings: { followedPodcasts: ['podscribe-acquired'] } }).settings.followedPodcasts).toEqual(['podscribe-acquired']);
    expect(initialState({ settings: { followedPodcasts: ['podscribe-new-show'], podcastNames: { 'podscribe-new-show': 'New Show' } } }).settings.podcastNames['podscribe-new-show']).toBe('New Show');
    expect(initialState({ settings: { lastSource: 'allin', followedPodcasts: ['allin', 'podscribe-all-in-with-chamath-jason-sacks-friedberg'], podcastNames: { allin: 'All-In Podcast' } }, sources: [{ id: 'allin', name: 'All-In', category: 'podcast' }] }).settings).toMatchObject({
      lastSource: 'podscribe-all-in-with-chamath-jason-sacks-friedberg',
      followedPodcasts: ['podscribe-all-in-with-chamath-jason-sacks-friedberg'],
      podcastNames: { 'podscribe-all-in-with-chamath-jason-sacks-friedberg': 'All-In Podcast' },
    });
    expect(initialState({ settings: { followedPodcasts: ['joerogan'], lastSource: 'joerogan' } }).settings).toMatchObject({
      lastSource: 'podscribe-the-joe-rogan-experience', followedPodcasts: ['podscribe-the-joe-rogan-experience'],
    });
    expect(initialState({ settings: { lastSource: 'allin' }, sources: [{ id: 'allin', name: 'All-In', category: 'podcast' }] }).settings.followedPodcasts)
      .toEqual(['podscribe-all-in-with-chamath-jason-sacks-friedberg']);
  });

  it('opens registered podcasts in Qiaomu rewrite mode and direct-only shows in source mode', () => {
    const sources = [{ id: 'podscribe-acquired', name: 'Acquired', category: 'podcast' }];
    expect(podcastDefaultMode({ id, sourceId: 'podscribe-acquired', title: 'Episode' }, sources, [])).toBe('rewrite');
    expect(podcastDefaultMode({ id, sourceId: 'allin', title: 'Episode' }, [], ['allin'])).toBe('rewrite');
    expect(podcastDefaultMode({ id, sourceId: 'podscribe-invest-like-the-best', title: 'Episode', podcastSlug: 'invest-like-the-best' }, [], ['podscribe-invest-like-the-best'])).toBe('original');
    expect(podcastDefaultMode({ id, sourceId: 'ordinary-feed', title: 'Episode' }, [], [])).toBeNull();
  });

  it('replaces a podcast teaser with escaped source transcript and retains Qiaomu rewrite', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/podscribe-transcript')) return response({ transcript: 'First <unsafe> line\nSecond line', sourceUrl: 'https://podcasts.happyscribe.com/acquired/episode' });
      if (url.endsWith('/rewrite')) return response({ rewrite: { body: '乔木转写正文' } });
      if (url.endsWith('/translation')) return response({ translation: null });
      return response({ entry });
    });
    const { bundle } = await api.article(id);
    expect(bundle.entry.content).toContain('First &lt;unsafe&gt; line');
    expect(bundle.entry.content).not.toContain('Only a short summary');
    expect(bundle.rewrite?.body).toBe('乔木转写正文');
  });

  it('does not present a teaser as the transcript when extraction fails', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/podscribe-transcript')) return { status: 503, text: '{}' };
      if (url.endsWith('/rewrite')) return response({ rewrite: null });
      if (url.endsWith('/translation')) return response({ translation: null });
      return response({ entry });
    });
    const { bundle, warnings } = await api.article(id);
    expect(bundle.entry.content).toBe('');
    expect(warnings.join('')).toContain('源文稿暂时无法取得');
  });
  it('recognizes All-In Shorts as clips without requesting a nonexistent episode transcript', async () => {
    const requests: string[] = [];
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      requests.push(url);
      if (url.endsWith('/rewrite')) return response({ rewrite: null });
      if (url.endsWith('/translation')) return response({ translation: null });
      if (url.endsWith('/podscribe-transcript')) throw new Error('Shorts must not request episode transcripts');
      return response({ entry: { ...entry, sourceId: 'allin', link: 'https://www.youtube.com/shorts/yLnJpR8H2kY' } });
    });
    const { bundle, warnings } = await api.article(id);
    expect(bundle.entry.content).toBe('');
    expect(warnings.join('')).toContain('短视频片段');
    expect(requests.some(url => url.endsWith('/podscribe-transcript'))).toBe(false);
  });

  it('describes an unmatched full video as unavailable rather than a temporary outage', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/podscribe-transcript')) return { status: 404, text: '{"error":"没有唯一匹配"}' };
      if (url.endsWith('/rewrite')) return response({ rewrite: null });
      if (url.endsWith('/translation')) return response({ translation: null });
      return response({ entry: { ...entry, sourceId: 'allin', link: 'https://www.youtube.com/watch?v=example' } });
    });
    const { warnings } = await api.article(id);
    expect(warnings.join('')).toContain('尚未找到与这条视频唯一对应');
    expect(warnings.join('')).not.toContain('稍后重新加载');
  });
  it('reads an unregistered recommended show directly without generating a rewrite', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.includes('/episodes?')) return response({ episodes: [{ show_slug: 'invest-like-the-best', episode_slug: 'new-episode', title: 'New episode', description: 'Short teaser' }], pagination: { has_next: false } });
      if (url.endsWith('/transcript')) return response({ transcript: { segments: [{ text: 'The full original text.' }] }, episode: { url: 'https://podcasts.happyscribe.com/invest-like-the-best/new-episode' } });
      throw new Error('Unexpected request');
    });
    const page = await api.podcastEpisodes('podscribe-invest-like-the-best');
    const { bundle } = await api.article(page.entries[0].id, page.entries[0]);
    expect(bundle.entry.content).toContain('The full original text.');
    expect(bundle.rewrite).toBeNull();
  });
  it('links a direct All-In transcript to a uniquely matching full YouTube episode', async () => {
    const video = 'https://www.youtube.com/watch?v=JtomF4bGxHs';
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.includes('/episodes?')) return response({ episodes: [{ show_slug: 'all-in-with-chamath-jason-sacks-friedberg', episode_slug: 'adam', title: 'Adam Foroughi', published_at: '2026-09-22T10:00:00Z' }], pagination: { has_next: false } });
      if (url.endsWith('/transcript')) return response({ transcript: { segments: [{ text: 'Full source transcript' }] } });
      if (url.includes('/sources/allin/entries')) return response({ entries: [
        { id: 'video', sourceId: 'allin', title: 'Adam Foroughi', link: video, publishedTs: Date.parse('2026-09-22T10:00:00Z') },
        { id: 'short', sourceId: 'allin', title: 'Short clip', link: 'https://www.youtube.com/shorts/yLnJpR8H2kY' },
      ] });
      throw new Error('Unexpected request');
    });
    const page = await api.podcastEpisodes('podscribe-all-in-with-chamath-jason-sacks-friedberg');
    const { bundle } = await api.article(page.entries[0].id, page.entries[0]);
    expect(bundle.entry.videoUrl).toBe(video);
    expect(bundle.entry.content).toContain('Full source transcript');
    expect(bundle.rewrite).toBeNull();
  });
  it('does not link ambiguous or differently dated YouTube episodes', async () => {
    const preview = { id: 'podscribe-the-joe-rogan-experience/ron', sourceId: 'podscribe-the-joe-rogan-experience', title: '#2555 - Ron White', podcastSlug: 'the-joe-rogan-experience', episodeSlug: 'ron', publishedTs: Date.parse('2026-09-22T10:00:00Z') };
    const api = new RssApi('https://rss.qiaomu.ai', async url => {
      if (url.endsWith('/transcript')) return response({ transcript: { segments: [{ text: 'Transcript' }] } });
      if (url.includes('/sources/joerogan/entries')) return response({ entries: [
        { id: 'old', sourceId: 'joerogan', title: 'Joe Rogan Experience #2555 - Ron White', link: 'https://www.youtube.com/watch?v=J3SIbt2s28Y', publishedTs: Date.parse('2026-08-01T10:00:00Z') },
      ] });
      throw new Error('Unexpected request');
    });
    const { bundle } = await api.article(preview.id, preview);
    expect(bundle.entry.videoUrl).toBeNull();
  });
  it('uses an explicit episode video from any overseas podcast description but ignores guest channels', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async () => response({ episodes: [
      { show_slug: 'masters-of-scale', episode_slug: 'one', title: 'One', description: 'Watch this episode on YouTube: https://www.youtube.com/watch?v=Y4jc66RXjvkSubscribe to our feed' },
      { show_slug: 'masters-of-scale', episode_slug: 'two', title: 'Two', description: 'Follow our guest at https://www.youtube.com/watch?v=JtomF4bGxHs' },
    ], pagination: { has_next: false } }));
    const page = await api.podcastEpisodes('podscribe-masters-of-scale');
    expect(page.entries[0].videoUrl).toBe('https://www.youtube.com/watch?v=Y4jc66RXjvk');
    expect(page.entries[1].videoUrl).toBeNull();
  });

  it('keeps exact dates and upstream metadata without inventing dates from relative text', async () => {
    const api = new RssApi('https://rss.qiaomu.ai', async () => response({ episodes: [
      { show_slug: 'pivot', episode_slug: 'exact', title: 'Exact', published_at: '2026-08-07T12:00:00+02:00', published_relative: 'about 2 months ago', views: 170, word_count: 13993, duration_seconds: 4562 },
      { show_slug: 'pivot', episode_slug: 'relative', title: 'Relative', published_at: '4 months ago', published_relative: '4 months ago', views: 0 },
    ], pagination: { has_next: false } }));
    const page = await api.podcastEpisodes('podscribe-pivot');
    expect(page.entries[0].published).toBe('2026-08-07T10:00:00.000Z');
    expect(page.entries[0].podcastViews).toBe(170);
    expect(page.entries[0].podcastWordCount).toBe(13993);
    expect(page.entries[0].podcastDurationSeconds).toBe(4562);
    expect(page.entries[1].publishedTs).toBeUndefined();
    expect(page.entries[1].publishedRelative).toBe('4 months ago');
  });
});
