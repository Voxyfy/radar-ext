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

  // TR: Profilde yazan resmî sayılar (ör. 142 takipçi / 143 takip). Çekilen liste bundan kısaysa eksiktir.
  // EN: The official counts shown on the profile. If the fetched list is shorter, it is incomplete.
  const countsFromHtml = (html) => {
    const pick = (...res) => { for (const re of res) { const m = html.match(re); if (m) return +m[1]; } return null; };
    return {
      followers: pick(/"edge_followed_by":\{"count":(\d+)/, /"follower_count":(\d+)/),
      following: pick(/"edge_follow":\{"count":(\d+)/, /"following_count":(\d+)/),
    };
  };

  // TR: { id, expected: { followers, following } } döner. / EN: Returns { id, expected: { followers, following } }.
  async function resolveId(name, report) {
    const pageHtml = document.documentElement.innerHTML;
    let id = idFromHtml(pageHtml, name);
    if (id) return { id, expected: countsFromHtml(pageHtml) };
    // TR: SPA geçişinde sayfa içi JSON eski kalabilir; profil HTML'ini taze çek.
    // EN: After an SPA navigation the embedded JSON can be stale; fetch the profile HTML fresh.
    try {
      const res = await fetch(`https://www.instagram.com/${encodeURIComponent(name)}/`, { credentials: 'include' });
      if (res.ok) { const html = await res.text(); id = idFromHtml(html, name); if (id) return { id, expected: countsFromHtml(html) }; }
    } catch {}
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(name)}`, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(90_000); continue; }
      if (!res.ok) throw new Error(t('errHttp', res.status));
      const u = (await res.json()).data.user;
      return { id: String(u.id), expected: { followers: u.edge_followed_by?.count ?? null, following: u.edge_follow?.count ?? null } };
    }
    throw new Error(t('errNoId'));
  }

  // --- List fetching --------------------------------------------------------
  // TR: Instagram bu endpoint'te büyük count değerlerinde listeyi sessizce kırpıp next_max_id vermiyor
  //     (142 takipçili bir hesapta 114-125 kayıt dönüyordu). Web istemcisi 12'lik sayfalar kullanır; biz 50.
  // EN: With large count values Instagram silently truncates this list and omits next_max_id
  //     (a 142-follower account returned 114-125). The web client uses pages of 12; we use 50.
  async function fetchPages(targetId, kind, pageSize, seen, report) {
    let maxId = null;
    while (true) {
      const url = `https://www.instagram.com/api/v1/friendships/${targetId}/${kind}/?count=${pageSize}&search_surface=follow_list_page${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`;
      const res = await fetch(url, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(60_000); continue; }
      // TR: Gizli hesap + takip yok → 400/403. / EN: Private account you don't follow → 400/403.
      if (res.status === 400 || res.status === 403) throw new Error(t('errPrivate'));
      if (!res.ok) throw new Error(t('errHttp', res.status));
      const json = await res.json();
      const users = json.users ?? [];
      // TR: id ile tekilleştir; sayfalar çakışabilir. / EN: Dedupe by id; pages can overlap.
      for (const u of users) seen.set(String(u.pk), { id: String(u.pk), username: u.username, full_name: u.full_name ?? '' });
      report({ stage: 'progress', kind, count: seen.size });
      if (!json.next_max_id || users.length === 0) break;
      maxId = json.next_max_id;
      // TR: 2–4 sn rastgele bekleme: hız sınırına takılmamak ve kullanıcının hesabını korumak için.
      // EN: 2–4 s random delay: avoids rate limits and protects the user's account.
      await sleep(2000 + Math.random() * 2000);
    }
  }

  async function fetchAll(targetId, kind, expected, report) {
    const seen = new Map();
    await fetchPages(targetId, kind, 50, seen, report);
    if (expected != null && seen.size < expected) {
      // TR: Eksik geldi; küçük sayfalarla bir tur daha atıp birleştir.
      // EN: Came back short; do one more pass with smaller pages and merge.
      report({ stage: 'retry', kind, count: seen.size, expected });
      await sleep(3000);
      await fetchPages(targetId, kind, 25, seen, report);
    }
    return [...seen.values()];
  }

  async function takeSnapshot(report) {
    const ownId = document.cookie.match(/ds_user_id=(\d+)/)?.[1];
    if (!ownId) throw new Error(t('errNotLoggedIn'));
    const username = currentUsername();
    // TR: Profil sayfasında değilsek (ana sayfa) kendi hesabı alınır.
    // EN: If not on a profile page (home feed), snapshot the user's own account.
    let target, expected = { followers: null, following: null };
    if (username) {
      const r = await resolveId(username, report);
      target = { id: r.id, username, full_name: '' };
      expected = r.expected;
    } else {
      target = { id: ownId, username: t('panelOwnAccount'), full_name: '' };
    }

    const followers = await fetchAll(target.id, 'followers', expected.followers, report);
    const following = await fetchAll(target.id, 'following', expected.following, report);

    // TR: Profil sayısı kapalı/askıya alınmış hesapları da içerir; 1-2 fark normal, fazlası eksik çekimdir.
    // EN: The profile count includes deactivated/suspended accounts; 1-2 off is normal, more means truncation.
    const short = (want, list) => want != null && want - list.length > 2;
    const incomplete = short(expected.followers, followers) || short(expected.following, following);

    const snapshot = { kind: 'radar-snapshot', version: 2, takenAt: new Date().toISOString(), target, expected, incomplete, followers, following };
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
        .then((s) => report({ stage: 'done', followers: s.followers.length, following: s.following.length, expected: s.expected, incomplete: s.incomplete }))
        .catch((e) => report({ stage: 'error', message: e.message }))
        .finally(() => { running = false; });
      sendResponse({ ok: true });
    }
  });
})();
