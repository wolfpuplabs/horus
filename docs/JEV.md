# JEV — Justify · Evaluate · Verdict

Lapisan keputusan Horus. Ada dua bagian:

1. **Gate keputusan proyek** — setiap inisiatif (fitur, sumber data, perubahan
   biaya) mendapat verdict **GO / CONDITIONAL / NO-GO** berbasis ROI sosial,
   risiko, dan bukti, di setiap tahap SDLC ([SDLC.md](SDLC.md)).
2. **Layer prioritas di peta** — menerapkan prinsip yang sama ke data:
   bencana mana yang didahulukan ([PRD.md §5](PRD.md)).

## 1. Justify — apa yang diisi

File `jev/initiatives/<id>.json`:

| Bagian | Isi |
| --- | --- |
| `stage` | idea / discovery / build / release / operate |
| `costs` | `buildHours`, `oneOffUsd`, `infraUsdPerMonth`, `maintenanceHoursPerMonth` |
| `outcomes[]` | `quantityPerYear`, `proxyValuePerUnit` (USD), `confidence`, `attribution`, `deadweight` (0–1) |
| `risks[]` | `likelihood`, `impact` (1–5), `blocking`, `status`, `mitigation` |
| `evidence[]` | `kind` + `ref` (path di repo; dicek keberadaannya) |
| `conditions[]` | syarat bila verdict CONDITIONAL |

Model ROI = **SROI** (social return on investment), cocok untuk LSM: manfaat
diukur sebagai outcome sosial yang dinilai dengan *financial proxy*.

## 2. Evaluate — rumus

```
nilai_outcome/tahun = jumlah × proxy × confidence × attribution × (1 − deadweight)
PV_biaya   = biaya_sekali + PV(biaya_bulanan, horizon, diskonto)
PV_manfaat = PV(Σ nilai_outcome / 12, horizon, diskonto)
SROI       = PV_manfaat / PV_biaya
NPV        = PV_manfaat − PV_biaya
payback    = biaya_sekali / (manfaat_bulanan − biaya_bulanan)
risiko     = likelihood × impact (maks. per inisiatif)
```

Parameter global di `jev/config.json`: horizon 36 bulan, diskonto 8%/tahun,
tarif kerja US$15/jam.

- **confidence** — seberapa yakin angkanya (asumsi 0,3–0,5; terukur 0,8+).
- **attribution** — porsi manfaat yang benar-benar karena Horus.
- **deadweight** — porsi yang akan terjadi juga tanpa Horus.

## 3. Verdict — aturan

**NO-GO** bila salah satu:
- SROI < `minSroiConditional` tahap itu;
- risiko tertinggi > `maxRiskScore`;
- ada risiko `blocking` yang belum `mitigated`;
- bukti wajib tahap itu kurang, atau `ref` tidak ditemukan di repo.

**CONDITIONAL** bila lolos semua di atas tapi SROI < `minSroiGo` atau payback
melewati batas → lanjut hanya dengan `conditions` tertulis.

**GO** bila tidak ada keberatan.

## 4. Menjalankan

```bash
npm run jev              # tabel verdict
npm run jev -- --write   # perbarui docs/jev/DECISIONS.md
npm run jev:check        # gate CI
```

Engine: `src/jev/score.js` (murni, diuji di `src/jev/score.test.mjs`).
CLI: `scripts/jev.mjs`.

## 5. Contoh: kenapa keputusan sudah diambil dari awal

| Kasus | Verdict | Alasan |
| --- | --- | --- |
| SaaS komersial | NO-GO di **idea** | SROI 0,25×, risiko lisensi blocking (25). Tidak ada jam kerja terbuang. |
| Bahasa Indonesia | NO-GO di **idea** | SROI 0,75× dengan asumsi saat ini → perlu bukti pengguna dulu (discovery). |
| FIRMS key | GO di idea | Murah, tapi tahap build tertahan: FIRMS tidak bisa dijangkau dari Vercel (B-04) → diganti GIBS. |
| Peta 3D lazy-load | GO | Menghindari biaya kuota tanpa mengurangi manfaat. |

## 6. Batasan

- Angka proxy & kuantitas awal adalah **asumsi**; verdict hanya sebaik datanya.
  Wajib diganti dengan data terukur sebelum tahap `operate`.
- SROI tidak menangkap semua nilai (mis. nilai keanekaragaman hayati intrinsik).
  Gunakan `conditions` untuk pertimbangan kualitatif.
