# Audit Keamanan, Bug & Technical Debt — Horus

Cakupan: deployment Vercel (`api/gev.js`, `server/vercel/`), proxy server baru
(`/api/disasters`, `/api/gbif-tiles`, `/api/priority`), layer lingkungan,
dependency, CI, dan konfigurasi key. Tanggal: 26 Okt 2026. Metode: review kode,
`npm audit`, pemindaian secret di git, uji endpoint production, dan log runtime
Vercel.

Status: **Fixed** = sudah diperbaiki dan ada test/bukti. **Mitigated** = risiko
diturunkan, belum hilang. **Open** = tercatat, belum dikerjakan.

## Ringkasan

| Kategori | Fixed | Mitigated | Open |
| --- | --- | --- | --- |
| Kerentanan keamanan | 7 | 2 | 2 |
| Bug | 6 | 0 | 0 |
| Technical debt | 1 | 1 | 7 |

Tidak ada secret yang ter-commit (pemindaian pola AWS, OpenAI, Google, GitHub,
private key). `npm audit --omit=dev`: 0 kerentanan.

## A. Kerentanan keamanan

| ID | Temuan | Severity | Status | Perbaikan / bukti |
| --- | --- | --- | --- | --- |
| F-01 | Di Vercel semua pengunjung tercatat sebagai **satu klien** (socket peer = proxy Vercel). Rate limit per-IP jadi rate limit global: satu orang bisa memblokir semua orang, dan limiter tidak membatasi penyalahgunaan per orang. | High | Fixed | `api/gev.js` memberi `gevClientAddress` dari `x-real-ip` (ditimpa Vercel, tidak bisa dipalsukan klien); `server/providers/common/peer.js`. Test: `src/tooling/vercelGuardrails.test.mjs`. |
| F-02 | Pemeriksaan **loopback** (`127.0.0.1`) memakai socket peer. Di platform lain dengan proxy lokal, request dari internet bisa terbaca sebagai loopback dan lolos gate admin (OAuth voice). | High | Fixed | `isLoopbackRequest` memakai `peerAddress()`; di Vercel nilainya `vercel:<ip>`, tidak pernah loopback. Test yang sama. |
| F-03 | Rewrite `/api/:path*` → `?__gevpath=` bisa membawa segmen `..` (path traversal ke route lain). | Medium | Fixed | `restoreApiUrl()` menolak segmen `..` dengan 400. Test. |
| F-04 | Proxy tile GBIF terbuka untuk **hotlink & scraping** dari situs lain, menghabiskan kuota function. | Medium | Fixed | Gate same-site (`admitSameSiteKeyless`), rate limit 600 tile/menit/klien, maksimal 32 in-flight. Test 403/404. |
| F-05 | `/api/disasters` membocorkan pesan error internal (`detail`) ke publik. | Low | Fixed | Detail hanya di log server. |
| F-06 | Dev dependency rentan: Vite (`launch-editor` command injection di Windows), Zod (memory exhaustion via puppeteer). | High (dev) | Fixed | `npm audit fix` (patch/minor saja); `npm audit` 0. |
| F-07 | Tanpa security header. | Low | Fixed | `vercel.json`: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. |
| M-01 | **Token Cesium ion tertanam di bundle JS** (bisa dibaca siapa saja). | Medium | Mitigated | Token hanya `assets:read`, URL dibatasi ke `horus-of-wolfpuplab.vercel.app`. Pantau tab Usage. |
| M-02 | Rate limiter & cache bersifat **in-memory per instance function**. Penyerang terdistribusi melewati limiter. | Medium | Mitigated | Cache CDN (`s-maxage`) menyerap sebagian besar trafik; instance terbatas. Tindak lanjut: Vercel Firewall rate-limit rule (O-02). |
| O-01 | **Tidak ada Content-Security-Policy.** Aplikasi memuat banyak sumber tile/skrip pihak ketiga dan template inline. | Medium | Open | Perlu inventaris origin lalu CSP `report-only` dulu. |
| O-02 | Tidak ada rate limit di level edge (Vercel Firewall). | Medium | Open | Tambah rule WAF untuk `/api/*` saat trafik publik naik. |

## B. Bug yang ditemukan & diperbaiki

| ID | Bug | Dampak | Perbaikan |
| --- | --- | --- | --- |
| B-01 | Vercel menambahkan `?path=` (dan `_vercel_share=` di share link) ke query. Route cuaca menolak parameter tak dikenal → **Rain radar & Satellite clouds HTTP 400**. | Layer cuaca mati di production | `restoreApiUrl` membuang `path` dan `_vercel_share`. Diverifikasi: `/api/weather/manifest` 200. |
| B-02 | Modul `ws` dimuat lewat `createRequire`, tidak ikut ter-bundle → **layer kapal error**. | Layer AIS mati | `includeFiles` memuat `node_modules/ws`. Diverifikasi: status berubah ke `missing-key`. |
| B-03 | Marker bencana memakai `disableDepthTestDistance: Infinity` → titik dari sisi bumi belakang **tembus ke depan** (titik di laut). | Peta menyesatkan | Batas 2.000 km; diverifikasi lewat screenshot. |
| B-04 | NASA FIRMS tidak merespons dari Vercel → setiap enable menahan function 60–120 s lalu gagal (**membakar kuota**). | Biaya & UX | Key dikosongkan; titik api pindah ke NASA GIBS (dimuat browser, 0 function). |
| B-05 | Google 3D Tiles dimuat setiap kunjungan → **1 sesi kuota Cesium per page load** (1.000/bulan). | Kuota habis ±33 kunjungan/hari | Lazy-load: 3D hanya saat dipilih. Diverifikasi: 0 request ke aset Google saat startup. |
| B-06 | GDACS MAP endpoint menolak (400) dan app list terpotong di 100 → banjir/kekeringan tidak muncul. | Data tidak lengkap | App list + SEARCH 30 hari per jenis bahaya. Diverifikasi: 342 kejadian GDACS termasuk 68 banjir. |

## C. Technical debt

| ID | Debt | Prioritas | Rencana |
| --- | --- | --- | --- |
| D-01 | CI hanya jalan di branch `main`, repo ini `master` → push ke `master` **tidak pernah diuji**. | High | **Fixed** (`.github/workflows/ci.yml`). |
| D-02 | Sumber yang butuh koneksi panjang (AISStream WebSocket) dan sumber lambat dari cloud (OpenSky) tidak cocok dengan function serverless. | Medium | **Mitigated**: default off. Pindah ke worker yang selalu hidup bila dibutuhkan. |
| D-03 | Test mem-pin hash skema voice, jumlah layer, dan token share-link → **setiap layer baru menyentuh ±8 test**. | Medium | Ganti pin hash dengan snapshot yang di-regenerate oleh skrip. |
| D-04 | Anggaran prompt voice 52.068/52.100 karakter — hampir penuh. | Medium | Ringkas deskripsi tool atau pisahkan enum layer. |
| D-05 | Modul sangat besar: `src/voice/gevActions.js` (4.824 baris), `src/data/bhoteKoshiEvent.js` (3.939), `server/providers/cctv/sources.js` (3.647). Chunk utama 3,7 MB. | Low | Pecah saat area itu disentuh; code-splitting per layer. |
| D-06 | UI hanya EN/ES/RU/ZH; pengguna utama Indonesia. | Medium | Inisiatif `indonesian-locale` (lihat JEV). |
| D-07 | Lisensi data non-komersial (TeleGeography, citra Bhote Koshi, OpenSky, sebagian dataset GBIF CC BY-NC) dan Vercel Hobby (non-komersial). | High bila komersial | Inisiatif `commercial-saas` = NO-GO sampai lisensi beres. |
| D-08 | 17 penanda TODO/FIXME di `src/` dan `server/`. | Low | Triage saat menyentuh file terkait. |
| D-09 | Cache server (FIRMS, Overpass, terrain) menulis ke `.gev-cache` di cwd; di Vercel diarahkan ke `/tmp` yang hilang saat cold start. | Low | Pindah ke Vercel KV/Blob bila hit-rate perlu dijaga. |

## Cara mengulang audit

```bash
npm audit --omit=dev           # dependency produksi
npm audit                      # termasuk dev
npm run check:boundaries       # kepemilikan modul
npm run jev:check              # gate keputusan
npm test                       # 8.500+ test
```
