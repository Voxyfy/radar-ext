// Radar — panel
// TR: Snapshot'ları chrome.storage.local'dan okur, iki snapshot arası farkı listeler.
// EN: Reads snapshots from chrome.storage.local and lists the diff between two of them.
(() => {
  const t = (k, ...s) => chrome.i18n.getMessage(k, s.map(String));
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('#q').placeholder = t('panelSearch');

  let snaps = [];
  let tab = 'startedFollowing';
  let currentTarget = null;
  // TR: Sayfalama; sekme/hesap/arama değişince sıfırlanır. / EN: Pagination; resets on tab/account/search change.
  const PAGE = 50;
  let page = 0;

  // --- Storage --------------------------------------------------------------
  const load = async () => {
    const { snapshots = [] } = await chrome.storage.local.get('snapshots');
    snaps = snapshots.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  };
  const save = () => chrome.storage.local.set({ snapshots: snaps });

  // --- Diff -----------------------------------------------------------------
  // TR: Kullanıcı adı değişebilir ama pratikte eşleme için yeterli; id yoksa (resmî dışa aktarım) yine çalışır.
  // EN: Usernames can change, but they're good enough for matching; works even without ids (official export).
  const keyOf = (u) => (u.username || u.id || '').toLowerCase();
  const toMap = (list) => new Map(list.map((u) => [keyOf(u), u]));
  const minus = (a, b) => [...a.values()].filter((u) => !b.has(keyOf(u)));
  const diff = (prev, curr) => {
    const cF = toMap(curr.followers), cG = toMap(curr.following);
    const pF = toMap(prev?.followers ?? []), pG = toMap(prev?.following ?? []);
    return {
      startedFollowing: prev ? minus(cG, pG) : [], // TR: hesap yeni kimi takip etti / EN: who the account started following
      stoppedFollowing: prev ? minus(pG, cG) : [], // TR: kimi takipten çıkardı / EN: who it unfollowed
      newFollowers: prev ? minus(cF, pF) : [],     // TR: onu yeni kim takip etti / EN: who newly followed it
      lostFollowers: prev ? minus(pF, cF) : [],    // TR: onu kim bıraktı / EN: who stopped following it
      following: [...cG.values()],
      followers: [...cF.values()],
    };
  };

  // --- Render ---------------------------------------------------------------
  const targets = () => {
    const m = new Map();
    for (const s of snaps) m.set(s.target.id, s.target);
    return [...m.values()];
  };

  function render({ resetSelection = false } = {}) {
    $('#snaps').innerHTML = snaps.map((s, i) => `
      <div class="snap"><span><b>@${esc(s.target.username)}</b> · ${fmt(s.takenAt)}</span>
      <span><b>${s.followers.length}</b> ${t('panelFollowersUnit')} · <b>${s.following.length}</b> ${t('panelFollowingUnit')} · <button data-del="${i}">${t('panelDelete')}</button></span></div>`).join('');

    $('#content').hidden = snaps.length === 0;
    $('#emptyState').hidden = snaps.length > 0;
    if (!snaps.length) return;

    const tSel = $('#targetSel');
    const tList = targets();
    if (!tList.some((x) => x.id === currentTarget)) currentTarget = tList.at(-1).id;
    tSel.innerHTML = tList.map((x) => `<option value="${esc(x.id)}">@${esc(x.username)}</option>`).join('');
    tSel.value = currentTarget;

    const mine = snaps.filter((s) => s.target.id === currentTarget);
    const opts = mine.map((s, i) => `<option value="${i}">${fmt(s.takenAt)}</option>`).join('');
    const prevSel = $('#prevSel'), currSel = $('#currSel');
    if (resetSelection || prevSel.dataset.target !== currentTarget) {
      prevSel.innerHTML = `<option value="-1">${t('panelOnlyLatest')}</option>` + opts;
      currSel.innerHTML = opts;
      currSel.value = String(mine.length - 1);
      prevSel.value = String(mine.length >= 2 ? mine.length - 2 : -1);
      prevSel.dataset.target = currentTarget;
    }
    const curr = mine[+currSel.value], prev = +prevSel.value >= 0 ? mine[+prevSel.value] : null;
    const d = diff(prev, curr);
    const delta = (a, b) => prev ? ` (${a - b >= 0 ? '+' : ''}${a - b})` : '';

    $('#stats').innerHTML = `
      <div class="stat"><div class="n">${curr.following.length}</div><div class="l">${t('statFollowing')}${delta(curr.following.length, prev?.following.length)}</div></div>
      <div class="stat"><div class="n">${curr.followers.length}</div><div class="l">${t('statFollowers')}${delta(curr.followers.length, prev?.followers.length)}</div></div>
      <div class="stat green"><div class="n">${prev ? d.startedFollowing.length : '–'}</div><div class="l">${t('statStarted')}</div></div>
      <div class="stat red"><div class="n">${prev ? d.stoppedFollowing.length : '–'}</div><div class="l">${t('statStopped')}</div></div>
      <div class="stat amber"><div class="n">${prev ? d.lostFollowers.length : '–'}</div><div class="l">${t('statLost')}</div></div>`;

    const tabs = [
      ['startedFollowing', 'tabStarted', 'green'],
      ['stoppedFollowing', 'tabStopped', 'red'],
      ['newFollowers', 'tabNewFollowers', ''],
      ['lostFollowers', 'tabLost', 'amber'],
      ['following', 'tabAllFollowing', ''],
      ['followers', 'tabAllFollowers', ''],
    ];
    $('#tabs').innerHTML = tabs.map(([k, l, c]) => `<div class="tab ${c} ${tab === k ? 'active' : ''}" data-tab="${k}">${t(l)}<span class="c">${d[k].length}</span></div>`).join('');

    const q = $('#q').value.trim().toLowerCase();
    const items = d[tab].filter((u) => !q || keyOf(u).includes(q) || (u.full_name ?? '').toLowerCase().includes(q))
      .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    const needsPrev = !prev && !['following', 'followers'].includes(tab);
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = items.slice(page * PAGE, (page + 1) * PAGE);
    $('#pager').hidden = items.length <= PAGE;
    $('#pgInfo').textContent = t('pagerRange', page * PAGE + 1, Math.min((page + 1) * PAGE, items.length), items.length);
    $('#pgPrev').disabled = page === 0;
    $('#pgNext').disabled = page >= pages - 1;
    $('#list').innerHTML = slice.length ? slice.map((u) => `
      <li><a href="https://www.instagram.com/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener">@${esc(u.username)}</a>
      <span class="name">${esc(u.full_name)}</span></li>`).join('')
      : `<li class="empty">${needsPrev ? t('panelNeedSecond') : t('panelEmpty')}</li>`;
  }

  // --- Events ---------------------------------------------------------------
  $('#targetSel').addEventListener('change', (e) => { currentTarget = e.target.value; page = 0; render({ resetSelection: true }); });
  $('#prevSel').addEventListener('change', () => { page = 0; render(); });
  $('#currSel').addEventListener('change', () => { page = 0; render(); });
  $('#q').addEventListener('input', () => { page = 0; render(); });
  $('#tabs').addEventListener('click', (e) => { const el = e.target.closest('[data-tab]'); if (el) { tab = el.dataset.tab; page = 0; render(); } });
  $('#pgPrev').addEventListener('click', () => { page--; render(); window.scrollTo({ top: 0 }); });
  $('#pgNext').addEventListener('click', () => { page++; render(); window.scrollTo({ top: 0 }); });
  $('#snaps').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    snaps.splice(+b.dataset.del, 1); await save(); render({ resetSelection: true });
  });
  $('#wipeBtn').addEventListener('click', async () => {
    if (!confirm(t('panelWipeConfirm'))) return;
    snaps = []; await save(); render({ resetSelection: true });
  });
  $('#exportBtn').addEventListener('click', () => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify({ kind: 'radar-backup', snapshots: snaps })], { type: 'application/json' })),
      download: `radar-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
  });
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      // TR: Yedek dosyası veya tek snapshot (eski konsol script'i biçimi de kabul).
      // EN: Backup file or a single snapshot (the legacy console-script format is accepted too).
      const incoming = json.kind === 'radar-backup' ? json.snapshots
        : /snapshot$/.test(json.kind ?? '') ? [json] : [];
      for (const s of incoming) {
        s.kind = 'radar-snapshot';
        if (!s.target) s.target = { id: s.userId ?? 'own', username: t('panelOwnAccount'), full_name: '' };
        const i = snaps.findIndex((x) => x.target.id === s.target.id && x.takenAt === s.takenAt);
        if (i >= 0) snaps[i] = s; else snaps.push(s);
      }
      snaps.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      await save(); render({ resetSelection: true });
    } catch (err) { console.error(err); }
    e.target.value = '';
  });

  // TR: Popup snapshot alırken panel açıksa anında yenile. / EN: Refresh live if a snapshot lands while the panel is open.
  chrome.storage.onChanged.addListener((ch) => { if (ch.snapshots) { snaps = ch.snapshots.newValue ?? []; render({ resetSelection: true }); } });

  load().then(() => render({ resetSelection: true }));
})();
