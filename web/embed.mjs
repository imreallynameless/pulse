const params = new URLSearchParams(location.search);
if (params.get('layout') === 'compact') document.documentElement.dataset.layout = 'compact';
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
// Existing source=cloud embed URLs remain compatible.
import('./cloud-embed.mjs');
