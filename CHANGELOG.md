# Changelog

## 1.0.1 — 2026-09-09

**TR**
- Düzeltme: takipçi listesi eksik çekiliyordu (142 takipçili hesapta 114-128 kayıt). Sebep: Instagram listeyi her istekte yeniden sıralıyor ve takipçi listesini sunucu tarafında 25'lik sayfaya zorluyor; düz offset sayfalaması aynı kişileri tekrar getirip bazılarını atlıyordu. Artık pencereler yarı yarıya örtüştürülüyor (25'lik sayfa, 12 adım), kayıtlar id ile tekilleştiriliyor, kısa kalırsa en fazla 3 tur birleştiriliyor.
- Profil başlığındaki resmî takipçi/takip sayısı okunup snapshot'a yazılıyor (`expected`). Liste 2'den fazla kısa kalırsa snapshot `eksik` işaretleniyor; popup ve panel uyarıyor.
- Panelde snapshot satırları `140/142` biçiminde çekilen/beklenen sayıyı gösteriyor.

**EN**
- Fix: follower lists were fetched incompletely (114-128 entries for a 142-follower account). Cause: Instagram re-ranks the list on every request and caps the followers list at 25 per page server-side, so plain offset pagination repeated some users and skipped others. Windows are now overlapped by half (page 25, step 12), entries are deduped by id, and up to 3 passes are merged if the result is short.
- The official follower/following counts from the profile header are stored in the snapshot (`expected`). If the list is more than 2 short, the snapshot is flagged `incomplete`; popup and panel warn about it.
- Snapshot rows in the panel show fetched/expected counts as `140/142`.

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
