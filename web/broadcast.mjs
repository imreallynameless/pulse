export function setupBroadcast() {
  const el = id => document.getElementById(id);
  let socket = null, ready = false;
  function updateEmbed() {
    const url = new URL('/embed.html', location.origin);
    url.searchParams.set('feed', el('feed').value.trim());
    el('preview').href = url.href;
    el('embed-code').value = `<iframe src="${url.href}" title="Live heart rate" width="320" height="150" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
  }
  function buttons(active) {
    el('start-share').disabled = active; el('stop-share').disabled = !active;
    el('feed').disabled = active; el('token').disabled = active;
  }
  function stop() {
    ready = false;
    const old = socket; socket = null;
    if (old) {
      old.close();
      el('share-status').textContent = 'Sharing stopped. The widget will show offline.';
    }
    buttons(false);
  }
  el('start-share').addEventListener('click', () => {
    if (socket) return;
    const feed = el('feed').value.trim(), token = el('token').value;
    if (!/^[a-z0-9-]{1,64}$/.test(feed) || !token) {
      el('share-status').textContent = 'Enter your feed name and private publishing token first.'; return;
    }
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/live`);
    socket = ws; buttons(true);
    el('share-status').textContent = 'Connecting to the relay…';
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      ws.send(JSON.stringify({ type: 'publish', feed, token }));
    });
    ws.addEventListener('message', event => {
      if (socket !== ws) return;
      const data = JSON.parse(event.data);
      if (data.type === 'ready') {
        ready = true;
        el('share-status').textContent = 'Sharing is enabled. New Fitbit readings will appear in the widget.';
      } else if (data.type === 'error') {
        stop(); el('share-status').textContent = data.message;
      }
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null; ready = false; buttons(false);
      el('share-status').textContent = 'Relay disconnected. Click Start sharing to reconnect.';
    });
    ws.addEventListener('error', () => {
      if (socket === ws) el('share-status').textContent = 'Cannot reach the relay. Check the server and try again.';
    });
  });
  el('stop-share').addEventListener('click', stop);
  el('feed').addEventListener('input', updateEmbed);
  el('copy-embed').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el('embed-code').value);
      el('share-status').textContent = 'Embed code copied.';
    } catch { el('share-status').textContent = 'Select the embed code above and copy it manually.'; }
  });
  el('hosting-note').textContent = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'Local preview only: this address works on your Mac. Deploy this server with HTTPS before adding the widget to a public website.'
    : 'The publishing token is private. Only the public feed address belongs in your website.';
  updateEmbed();
  return { stop, send(measurement) {
    if (ready && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount === 0) {
      socket.send(JSON.stringify({ type: 'reading', bpm: measurement.bpm, contact: measurement.contact }));
    }
  } };
}
