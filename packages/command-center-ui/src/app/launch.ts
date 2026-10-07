/**
 * The launch exchange: the single-use token arrives in the URL fragment (never sent to the server as a
 * URL), is posted once, and the fragment is cleared from history before the app opens.
 */
const status = document.getElementById('status');
const token = location.hash.startsWith('#') ? location.hash.slice(1) : '';
history.replaceState(null, '', '/launch');

async function launch(): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (status) status.textContent = 'The launch token is missing or invalid. Run the command again for a new link.';
    return;
  }
  const res = await fetch('/api/session/launch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-qandeel-founder-csrf': 'launch' }, credentials: 'same-origin', body: JSON.stringify({ token }) });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({ code: 'FOUNDER_SESSION_INVALID' }))) as { code?: string };
    if (status) status.textContent = `The launch failed: ${json.code ?? 'FOUNDER_SESSION_INVALID'}. A launch token works once and expires after ninety seconds.`;
    return;
  }
  location.replace('/');
}

void launch();
