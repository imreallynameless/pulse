const params = new URLSearchParams(location.search);
if (params.get('layout') === 'compact') document.documentElement.dataset.layout = 'compact';
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
// Only the embedding parent can change presentation; messages cannot change the feed.
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'pulse:theme') return;
  if (event.data.theme === 'light' || event.data.theme === 'dark') {
    document.documentElement.dataset.theme = event.data.theme;
  }
});
// Existing source=cloud embed URLs remain compatible.
import('./cloud-embed.ts');
