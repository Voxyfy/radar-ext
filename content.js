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

  // TR: Profilde yazan resmî sayılar (ör. "142 takipçi" / "143 takip"). Sayfa JSON'unda bulunmuyor;
  //     başlıktaki metinden okuruz (takipçi sayısında title="142" tam değeri verir). Çekilen liste bundan kısaysa eksiktir.
  // EN: The official counts shown on the profile ("142 followers" / "143 following"). Not present in the page
  //     JSON; read from the header text (the follower span carries title="142" with the exact value).
  const parseCount = (txt) => {
    const m = String(txt ?? '').trim().match(/^([\d.,]+)\s*[^\d]*$/);
    if (!m) return null; // "12,3B" / "1.2M" gibi kısaltmalar → bilinmiyor / abbreviated → unknown
    const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  const countsFromDom = () => {
    const out = { followers: null, following: null };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      const isF = /^(?:[\d.,]+\s*)?(takipçi|followers)$/i.test(t);
      const isG = /^(?:[\d.,]+\s*)?(takip|following)$/i.test(t);
      if (!isF && !isG) continue;
      const el = node.parentElement, box = el?.parentElement ?? el;
      const titled = box?.querySelector('[title]')?.getAttribute('title');
      const n = parseCount(titled) ?? parseCount((box?.textContent ?? '').replace(/(takipçi|takip|followers|following)/i, ''));
      if (n == null) continue;
      if (isF && out.followers == null) out.followers = n;
      if (isG && out.following == null) out.following = n;
    }
    return out;
  };
  const countsFromHtml = (html) => {
    const pick = (...res) => { for (const re of res) { const m = html.match(re); if (m) return +m[1]; } return null; };
    return {
      followers: pick(/"edge_followed_by":\{"count":(\d+)/, /"follower_count":(\d+)/),
      following: pick(/"edge_follow":\{"count":(\d+)/, /"following_count":(\d+)/),
    };
  };
  const mergeCounts = (a, b) => ({ followers: a.followers ?? b.followers, following: a.following ?? b.following });

  // TR: { id, expected: { followers, following } } döner. / EN: Returns { id, expected: { followers, following } }.
  async function resolveId(name, report) {
    const pageHtml = document.documentElement.innerHTML;
    let id = idFromHtml(pageHtml, name);
    if (id) return { id, expected: mergeCounts(countsFromDom(), countsFromHtml(pageHtml)) };
    // TR: SPA geçişinde sayfa içi JSON eski kalabilir; profil HTML'ini taze çek.
    // EN: After an SPA navigation the embedded JSON can be stale; fetch the profile HTML fresh.
    try {
      const res = await fetch(`https://www.instagram.com/${encodeURIComponent(name)}/`, { credentials: 'include' });
      if (res.ok) { const html = await res.text(); id = idFromHtml(html, name); if (id) return { id, expected: mergeCounts(countsFromDom(), countsFromHtml(html)) }; }
    } catch {}
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(name)}`, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(90_000); continue; }
      if (!res.ok) throw new Error(t('errHttp', res.status));
      const u = (await res.json()).data.user;
      return { id: String(u.id), expected: mergeCounts(countsFromDom(), { followers: u.edge_followed_by?.count ?? null, following: u.edge_follow?.count ?? null }) };
    }
    throw new Error(t('errNoId'));
  }

  // --- List fetching --------------------------------------------------------
  // TR: Instagram bu listeyi her istekte yeniden sıralıyor (follow_ranking_token her yanıtta değişir) ve
  //     takipçi listesini sunucu tarafında 25'lik sayfaya zorluyor. Offset'e göre düz sayfalama yapınca
  //     aynı kişiler tekrar geliyor, bazıları hiç gelmiyor (142 takipçili hesapta 114-128). Çözüm:
  //     pencereleri yarı yarıya örtüştür (25'lik sayfa, 12 adım) ve id ile tekilleştir; tek turda ~140/142.
  //     Yine kısa kalırsa tur tekrarlanıp birleştirilir. Takip listesi count=200 ile tek sayfada tam geliyor.
  // EN: Instagram re-ranks this list on every request (follow_ranking_token changes each response) and caps
  //     the followers list at 25 per page server-side. Plain offset pagination therefore repeats some users
  //     and skips others (114-128 of 142). Fix: overlap windows by half (page 25, step 12) and dedupe by id;
  //     one pass yields ~140/142. If still short, extra passes are merged. Following returns fully at count=200.
  async function fetchPass(targetId, kind, seen, report) {
    let offset = 0;
    for (let guard = 0; guard < 400; guard++) {
      const url = `https://www.instagram.com/api/v1/friendships/${targetId}/${kind}/?count=200&search_surface=follow_list_page${offset ? `&max_id=${offset}` : ''}`;
      const res = await fetch(url, { headers: HEADERS, credentials: 'include' });
      if (res.status === 429) { report({ stage: 'ratelimit' }); await sleep(60_000); continue; }
      // TR: Gizli hesap + takip yok → 400/403. / EN: Private account you don't follow → 400/403.
      if (res.status === 400 || res.status === 403) throw new Error(t('errPrivate'));
      if (!res.ok) throw new Error(t('errHttp', res.status));
      const json = await res.json();
      const users = json.users ?? [];
      for (const u of users) seen.set(String(u.pk), { id: String(u.pk), username: u.username, full_name: u.full_name ?? '' });
      report({ stage: 'progress', kind, count: seen.size });
      if (!json.next_max_id || users.length === 0) break;
      // TR: Sunucunun verdiği sayfa boyutunun yarısı kadar ilerle (25 → 12). / EN: Advance by half the served page (25 → 12).
      offset += Math.max(1, Math.floor(users.length / 2));
      // TR: 1–2 sn rastgele bekleme: hız sınırına takılmamak için. / EN: 1–2 s random delay to avoid rate limits.
      await sleep(1000 + Math.random() * 1000);
    }
  }

  async function fetchAll(targetId, kind, expected, report) {
    const seen = new Map();
    const enough = () => expected != null && seen.size >= expected - 1;
    for (let pass = 1; pass <= 3; pass++) {
      if (pass > 1) { report({ stage: 'retry', kind, count: seen.size, expected }); await sleep(2500); }
      const before = seen.size;
      await fetchPass(targetId, kind, seen, report);
      // TR: Beklenen bilinmiyorsa tek tur yeter; bilinip ulaşıldıysa ya da tur hiç yeni kayıt getirmediyse dur.
      // EN: Unknown expected → one pass; stop when reached, or when a pass adds nothing new.
      if (expected == null || enough() || seen.size === before) break;
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
