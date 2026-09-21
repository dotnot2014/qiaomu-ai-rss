import { safeUrl, type Entry } from './model';

export function audioUrl(entry: Entry): string | null {
  if (!entry.audio) return null;
  const url = safeUrl(entry.audio.url);
  if (!url || !url.startsWith('https://')) return null;
  const type = entry.audio.type?.toLowerCase();
  return !type || type.startsWith('audio/') ? url : null;
}

export function youtubeEmbedUrl(link: string | null | undefined): string | null {
  const value = link ? safeUrl(link) : null;
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|live)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2];
  } else if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.slice(1);
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
}

export function stopMedia(root: HTMLElement): void {
  for (const audio of root.querySelectorAll('audio')) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
  }
  for (const frame of root.querySelectorAll('iframe.qrs-video-frame')) frame.removeAttribute('src');
}

export function renderMedia(article: HTMLElement, entry: Entry): void {
  const audio = audioUrl(entry);
  if (audio) {
    const section = article.createEl('section', { cls: 'qrs-media qrs-audio' });
    section.createEl('strong', { text: '收听播客' });
    const player = section.createEl('audio', { attr: { controls: '', preload: 'none', src: audio } });
    player.addEventListener('error', () => { section.querySelector('.qrs-media-error')?.remove(); section.createEl('p', { cls: 'qrs-media-error', text: '音频暂时无法播放，可打开原文收听。' }); });
    return;
  }
  const embed = youtubeEmbedUrl(entry.link);
  if (!embed) return;
  const section = article.createEl('section', { cls: 'qrs-media qrs-video' });
  const button = section.createEl('button', { cls: 'qrs-video-start', text: '播放视频' });
  const guidance = section.createEl('p', { text: '点击后将从视频平台加载内容。无法播放时可在浏览器打开原文。' });
  button.addEventListener('click', () => {
    const frame = section.createEl('iframe', { cls: 'qrs-video-frame', attr: {
      src: `${embed}?autoplay=1&playsinline=1`, allow: 'autoplay; encrypted-media; picture-in-picture',
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
      referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: '',
    } });
    frame.setAttribute('title', '视频播放器');
    guidance.setText('视频来自外部平台；无法播放时可在浏览器打开原文。');
    button.remove();
  });
}
