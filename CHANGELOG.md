# Changelog

## 1.0.1 — 2026-09-09

**TR**
- Düzeltme: Instagram, `count=200` ile istenen takipçi listesini sessizce kırpıyordu (142 takipçili hesapta 114-125 kayıt). Artık 50'lik sayfalarla çekiliyor, kayıtlar id ile tekilleştiriliyor, eksik gelirse 25'lik sayfalarla ikinci tur atılıyor.
- Profildeki resmî takipçi/takip sayısı okunup snapshot'a yazılıyor (`expected`). Liste 2'den fazla kısa kalırsa snapshot `eksik` işaretleniyor; popup ve panel uyarıyor.
- Panelde snapshot satırları `125/142` biçiminde çekilen/beklenen sayıyı gösteriyor.

**EN**
- Fix: Instagram silently truncated follower lists requested with `count=200` (114-125 entries for a 142-follower account). Lists are now fetched in pages of 50, deduped by id, with a second pass at 25 if the result is short.
- The official follower/following counts from the profile are stored in the snapshot (`expected`). If the list is more than 2 short, the snapshot is flagged `incomplete`; popup and panel warn about it.
- Snapshot rows in the panel show fetched/expected counts as `125/142`.

## 1.0.0 — 2026-09-09

**TR**
- İlk kararlı sürüm.
- Profil sayfasından tek tıkla snapshot: takip ettiği + takipçi listeleri.
- Panel: hesap seçimi, iki snapshot arası fark (yeni takip etti / takipten çıkardı / yeni takipçisi / onu bırakan), tam listeler, arama, 50'lik sayfalama.
- Yedek al / yedek yükle (JSON).
- Aynı hesap için 20 saat içinde ikinci snapshot uyarısı, 429'da otomatik bekleme.
- TR / EN arayüz.

**EN**
- First stable release.
- One-click snapshot from a profile page: following + follower lists.
- Panel: account picker, diff between two snapshots (started following / unfollowed / new followers / lost followers), full lists, search, 50-per-page pagination.
- Back up / restore (JSON).
- Warning before a second snapshot of the same account within 20 hours; automatic wait on 429.
- TR / EN UI.
