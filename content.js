// Radar — content script (runs on instagram.com)
// TR: Popup'tan "snapshot" mesajı gelince açık profilin takipçi + takip ettiği listesini çeker ve
//     chrome.storage.local'a yazar. Hiçbir veri cihaz dışına çıkmaz.
// EN: On a "snapshot" message from the popup, fetches the open profile's followers + following
//     lists and writes them to chrome.storage.local. No data ever leaves the device.
//
// TR: Neden content script: istekler sayfanın kendi origin'inden, kullanıcının oturum çerezleriyle
//     gider; ayrı sunucu veya token gerekmez.
// EN: Why a content script: requests go from the page's own origin with the user's session
//     cookies; no separate server or token is needed.

(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = (k, ...s) => chrome.i18n.getMessage(k, s.map(String));
  // TR: Instagram web istemcisinin kendi kullandığı sabit app id; bunsuz API 400 döner.
  // EN: The fixed app id Instagram's own web client sends; the API returns 400 without it.
  const HEADERS = { 'x-ig-app-id': '936619743392459' };
  // TR: Profil olmayan üst düzey yollar. / EN: Top-level paths that are not profiles.
  const RESERVED = new Set(['explore', 'reels', 'direct', 'accounts', 'stories', 'p', 'reel']);

  const currentUsername = () => {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg && !RESERVED.has(seg) ? seg : null;
  };

  // --- User id resolution ---------------------------------------------------
  // TR: web_profile_info endpoint'i çok sıkı kısıtlı (anında 429). Önce sayfaya gömülü JSON'dan,
  //     sonra profil HTML'inden okuruz; API en son çare.
  // EN: The web_profile_info endpoint is heavily rate-limited (instant 429). We read the id from
  //     the JSON embedded in the page first, then from the profile HTML; the API is the last resort.
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idFromHtml = (html, name) => {
    const pats = [
      /"profile_id":"(\d+)"/,
      new RegExp(`"id":"(\\d+)","username":"${escRe(name)}"`, 'i'),
      new RegExp(`"username":"${escRe(name)}"[^{}]{0,400}?"(?:id|pk)":"(\\d+)"`, 'i'),
      new RegExp(`"(?:id|pk)":"(\\d+)"[^{}]{0,400}?"username":"${escRe(name)}"`, 'i'),
    ];
    for (const re of pats) { const m = html.match(re); if (m) return m[1]; }
    return null;
  };

  async function resolveId(name, report) {
    let id = idFromHtml(document.documentElement.innerHTML, name);
    if (id) return id;
    // TR: SPA geçişinde sayfa içi JSON eski kalabilir; profil HTML'ini taze çek.
    // EN: After an SPA navigation the embedded JSON can be stale; fetch the profile HTML fresh.
    try {
      const res = await fetch(`https://www.instagram.com/${encodeURIComponent(name)}/`, { credentials: 'include' });
      if (res.ok) { id = idFromHtml(await res.text(), name); if (id) return id; }
    } catch {}
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(name)}`, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(90_000); continue; }
      if (!res.ok) throw new Error(t('errHttp', res.status));
      return String((await res.json()).data.user.id);
    }
    throw new Error(t('errNoId'));
  }

  // --- List fetching --------------------------------------------------------
  async function fetchAll(targetId, kind, report) {
    const out = [];
    let maxId = null;
    while (true) {
      const url = `https://www.instagram.com/api/v1/friendships/${targetId}/${kind}/?count=200${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
      const res = await fetch(url, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(60_000); continue; }
      // TR: Gizli hesap + takip yok → 400/403. / EN: Private account you don't follow → 400/403.
      if (res.status === 400 || res.status === 403) throw new Error(t('errPrivate'));
      if (!res.ok) throw new Error(t('errHttp', res.status));
      const json = await res.json();
      for (const u of json.users ?? []) out.push({ id: String(u.pk), username: u.username, full_name: u.full_name ?? '' });
      report({ stage: 'progress', kind, count: out.length });
      if (!json.next_max_id) break;
      maxId = json.next_max_id;
      // TR: 2–4 sn rastgele bekleme: hız sınırına takılmamak ve kullanıcının hesabını korumak için.
      // EN: 2–4 s random delay: avoids rate limits and protects the user's account.
      await sleep(2000 + Math.random() * 2000);
    }
    return out;
  }

  async function takeSnapshot(report) {
    const ownId = document.cookie.match(/ds_user_id=(\d+)/)?.[1];
    if (!ownId) throw new Error(t('errNotLoggedIn'));
    const username = currentUsername();
    // TR: Profil sayfasında değilsek (ana sayfa) kendi hesabı alınır.
    // EN: If not on a profile page (home feed), snapshot the user's own account.
    const target = username
      ? { id: await resolveId(username, report), username, full_name: '' }
      : { id: ownId, username: t('panelOwnAccount'), full_name: '' };

    const followers = await fetchAll(target.id, 'followers', report);
    const following = await fetchAll(target.id, 'following', report);

    const snapshot = { kind: 'radar-snapshot', version: 2, takenAt: new Date().toISOString(), target, followers, following };
    const { snapshots = [] } = await chrome.storage.local.get('snapshots');
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    await chrome.storage.local.set({ snapshots });
    return snapshot;
  }

  let running = false;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') { sendResponse({ ok: true, username: currentUsername() }); return; }
    if (msg?.type === 'snapshot') {
      if (running) { sendResponse({ ok: false, error: 'busy' }); return; }
      running = true;
      // TR: İlerleme popup'a runtime mesajıyla akar; popup kapansa da çekim sürer.
      // EN: Progress streams to the popup via runtime messages; fetching continues if the popup closes.
      const report = (p) => chrome.runtime.sendMessage({ channel: 'radar-progress', ...p }).catch(() => {});
      takeSnapshot(report)
        .then((s) => report({ stage: 'done', followers: s.followers.length, following: s.following.length }))
        .catch((e) => report({ stage: 'error', message: e.message }))
        .finally(() => { running = false; });
      sendResponse({ ok: true });
    }
  });
})();
