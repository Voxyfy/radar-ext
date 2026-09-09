// Radar — popup
// TR: Hedefi gösterir, snapshot tetikler, ilerlemeyi yazar.
// EN: Shows the target, triggers a snapshot, displays progress.
const t = (k, ...s) => chrome.i18n.getMessage(k, s.map(String));
const $ = (s) => document.querySelector(s);
// TR: Aynı hesap için iki snapshot arası önerilen en az süre (saat).
// EN: Recommended minimum gap between two snapshots of the same account (hours).
const MIN_HOURS = 20;

document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });

const msg = (text, cls = '') => { const m = $('#msg'); m.textContent = text; m.className = `msg ${cls}`; };
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const setButton = (label, cls) => { const b = $('#take'); b.textContent = t(label); b.className = cls; };

let tabId = null, forceMode = false;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tab?.url?.startsWith('https://www.instagram.com/')) { msg(t('popupNotOnSite'), 'warn'); $('#take').disabled = true; return; }

  // TR: Content script yüklü mü? Eklenti kurulduktan önce açılan sekmelerde olmaz.
  // EN: Is the content script loaded? Tabs opened before install won't have it.
  let pong;
  try { pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' }); } catch {}
  if (!pong?.ok) { msg(t('popupReload'), 'warn'); $('#take').disabled = true; return; }

  const key = pong.username ?? t('panelOwnAccount');
  $('#user').textContent = pong.username ? `@${pong.username}` : key;

  // TR: Bu hesap için son snapshot çok yeniyse uyar; kullanıcı yine de alabilir.
  // EN: Warn if the last snapshot for this account is very recent; the user may still proceed.
  const { snapshots = [] } = await chrome.storage.local.get('snapshots');
  const last = snapshots.filter((s) => s.target.username === key).at(-1);
  $('#last').textContent = last ? fmt(last.takenAt) : t('popupNever');
  if (last && Date.now() - new Date(last.takenAt) < MIN_HOURS * 3600_000) {
    msg(t('popupTooSoon', MIN_HOURS), 'warn');
    setButton('popupForce', 'warn');
    forceMode = true;
  }
}

$('#take').addEventListener('click', async () => {
  $('#take').disabled = true;
  $('#take').textContent = t('popupTaking');
  msg('');
  const res = await chrome.tabs.sendMessage(tabId, { type: 'snapshot' }).catch(() => null);
  if (!res?.ok) { msg(t('popupError', res?.error ?? '?'), 'err'); $('#take').disabled = false; }
});

$('#panel').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') }));

chrome.runtime.onMessage.addListener((m) => {
  if (m?.channel !== 'radar-progress') return;
  switch (m.stage) {
    case 'progress': msg(t('popupProgress', t(m.kind === 'followers' ? 'kindFollowers' : 'kindFollowing'), m.count)); break;
    case 'ratelimit': msg(t('popupRateLimit'), 'warn'); break;
    case 'done':
      msg(t('popupDone', m.followers, m.following), 'ok');
      $('#last').textContent = fmt(new Date().toISOString());
      setButton('popupForce', 'warn'); $('#take').disabled = false; forceMode = true;
      break;
    case 'error':
      msg(t('popupError', m.message), 'err');
      setButton(forceMode ? 'popupForce' : 'popupTake', forceMode ? 'warn' : 'primary'); $('#take').disabled = false;
      break;
  }
});

init();
