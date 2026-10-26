# SDLC — Horus

Siklus hidup pengembangan Horus. Setiap tahap punya **gate JEV**: inisiatif tidak
boleh pindah tahap tanpa verdict GO (atau CONDITIONAL dengan syarat tertulis).
ROI dihitung sejak tahap pertama, bukan setelah fitur jadi.

```
 idea ──► discovery ──► build ──► release ──► operate
  │           │           │          │           │
 JEV        JEV         JEV        JEV         JEV (bulanan)
 SROI≥1    +validasi   +PRD,      +test,      +outcome
           pengguna    test plan   audit,      terukur
                                   rollback
```

## 1. Tahap & gate

| Tahap | Pertanyaan | Bukti wajib (`jev/config.json`) | Ambang SROI | Risiko maks. |
| --- | --- | --- | --- | --- |
| **idea** | Apakah layak dipikirkan? | problem-statement, roi-estimate | ≥1,0 (GO ≥2,0) | 20 |
| **discovery** | Apakah pengguna benar butuh? | + user-validation | ≥1,2 | 16 |
| **build** | Apakah layak dibangun sekarang? | + prd, test-plan | ≥1,2; payback ≤36 bln | 16 |
| **release** | Apakah aman dirilis? | + tests, security-audit, rollback-plan | ≥1,2 | 12 |
| **operate** | Apakah masih layak dijalankan? | + outcome-measurement | ≥1,0 | 12 |

Tahap `build`, `release`, `operate` **memblokir CI**: bila ada inisiatif di
tahap ini dengan verdict NO-GO, `npm run jev:check` gagal dan PR tidak bisa
di-merge.

## 2. Alur kerja harian

1. **Buka/ubah inisiatif** — `jev/initiatives/<id>.json`: biaya, outcome
   (dengan confidence, attribution, deadweight), risiko, bukti.
2. **Cek keputusan** — `npm run jev`. Bila NO-GO, berhenti atau ubah lingkup.
3. **Branch** — `feature/<id>` dari `master`. Jangan push langsung ke `master`
   untuk fitur (perbaikan darurat boleh, lihat §6).
4. **Bangun** dengan guardrail di §4.
5. **Validasi lokal** (harus bersih sebelum push):
   ```bash
   npm run format:check
   npm run check:boundaries
   npm run i18n
   npm test
   npm run build
   npm run jev -- --write && npm run jev:check
   ```
6. **Preview** — push branch → Vercel membuat preview deployment. Uji endpoint
   dan tampilan di sana (bukan di production).
7. **PR → review → merge** ke `master` → deploy production otomatis.
8. **Verifikasi production** — endpoint utama merespons, log runtime bersih
   (lihat §5).

## 3. Lingkungan

| Lingkungan | Pemicu | URL | Data/key |
| --- | --- | --- | --- |
| Lokal | `npm run dev` | localhost:5173 | `.env` lokal (POWER UP panel) |
| Preview | push branch apa pun | `horus-git-<branch>-…vercel.app` | env Preview Vercel |
| Production | merge ke `master` | horus-of-wolfpuplab.vercel.app | env Production Vercel |

Key disimpan di Vercel Environment Variables. Key yang berakhir di browser
(Cesium, Google) **wajib** dibatasi URL. Key server (FIRMS, AISStream, OpenAI)
bertipe *sensitive*.

## 4. Guardrails

### Proses (otomatis di CI — `.github/workflows/ci.yml`)
- Jalan di setiap PR dan push ke `master`.
- Format, batas paket modul, token share-link, test unit, build.
- **Gate JEV** (`npm run jev:check`): gagal bila inisiatif build/release/operate
  NO-GO atau `docs/jev/DECISIONS.md` tidak sinkron.
- i18n: katalog harus lengkap untuk semua bahasa.

### Runtime (di kode)
- Setiap proxy: timeout, batas ukuran respons, rate limit per klien
  (`x-real-ip` di Vercel), coalescing request, cache + `stale` saat hulu gagal.
- Same-site gate untuk endpoint yang bisa di-hotlink (tile GBIF).
- Function maks. 300 s; alur normal < 15 s. Sumber yang tidak cocok untuk
  serverless dimatikan default (AIS, FIRMS).
- Sumber berbayar per sesi (Google 3D) dimuat hanya atas pilihan pengguna.
- Header keamanan di `vercel.json`.

### Produk
- Layer yang bisa disalahtafsirkan menuliskan batasannya (deforestasi,
  habitat, skor prioritas).
- Kredit & lisensi setiap sumber tampil di aplikasi.

## 5. Definition of Done

- [ ] Inisiatif JEV ada dan verdict GO/CONDITIONAL untuk tahapnya.
- [ ] Semua perintah §2.5 bersih; jumlah test lulus ≥ baseline.
- [ ] Test baru untuk logika baru (normalizer, skor, guardrail).
- [ ] Teks UI baru diterjemahkan (ES/RU/ZH; ID bila locale tersedia).
- [ ] Sumber data baru dicatat di `DATA_SOURCES.md` + `dataCredits.js`.
- [ ] Diverifikasi di preview, lalu di production setelah merge.
- [ ] Temuan keamanan baru dicatat di `docs/SECURITY-AUDIT.md`.

## 6. Rollback & insiden

**Rollback (< 2 menit):** Vercel → Deployments → pilih deployment production
sebelumnya → *Promote to Production*. Atau `git revert <sha>` lalu push ke
`master`. Key yang bocor: regenerate di penyedia (Cesium ion → *Regenerate*),
ganti di Vercel, redeploy.

**Insiden:**
1. Lihat log runtime Vercel (Hobby menyimpan 1 jam — cek segera).
2. Bila satu sumber hulu bermasalah, matikan layer-nya (atau kosongkan key)
   alih-alih rollback seluruh aplikasi.
3. Catat di `docs/SECURITY-AUDIT.md` (bagian B) dengan penyebab & perbaikan.
4. Bila insiden memengaruhi biaya/kuota, perbarui risiko di inisiatif JEV.

## 7. Review berkala

- **Bulanan:** isi angka outcome terukur di `jev/initiatives/*.json`, jalankan
  `npm run jev -- --write`, cek kuota Cesium & Vercel.
- **Per kuartal:** ulangi audit (`npm audit`, review endpoint baru), tinjau
  bobot skor prioritas bersama mitra.
