import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('phone reader layout', () => {
  it('replaces the hidden host header spacing with only the status-bar safe area', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-header\s*{[^}]*display: none;/);
    expect(css).toMatch(/\.is-phone \.mod-root \.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-content\s*{[^}]*margin-top:var\(--safe-area-inset-top,env\(safe-area-inset-top,0px\)\);/);
  });
});
