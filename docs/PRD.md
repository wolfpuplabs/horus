# PRD — Horus: Pemantauan Lingkungan Berbasis Globe

| | |
| --- | --- |
| Pemilik | wolfpuplabs |
| Status | Live (release) — https://horus-of-wolfpuplab.vercel.app |
| Basis | Fork God's Eye View (MIT), di-rebrand dan difokuskan ke lingkungan |
| Keputusan | Setiap fitur melewati gate JEV ([JEV.md](JEV.md)); keputusan terkini di [jev/DECISIONS.md](jev/DECISIONS.md) |

## 1. Masalah

Analis LSM lingkungan dan pemerintah daerah di Indonesia harus menggabungkan
sendiri data deforestasi, titik api, banjir/bencana, dan sebaran spesies dari
banyak portal (GFW, FIRMS, GDACS, BNPB, GBIF). Prosesnya:

- **lambat** — membuka 4–6 situs dan mencocokkan lokasi secara manual;
- **tidak memberi urutan** — ratusan kejadian tampil setara, tanpa petunjuk
  mana yang paling berdampak bagi alam;
- **mahal** untuk lembaga kecil yang tidak punya tim GIS.

## 2. Tujuan & ukuran keberhasilan

Semua metrik di bawah menjadi *outcome* di model ROI JEV
(`jev/initiatives/environment-core.json`). Angka awal adalah **asumsi** yang
wajib diganti dengan data mitra.

| Tujuan | Metrik | Target 6 bulan | Cara ukur |
| --- | --- | --- | --- |
| Menghemat waktu analis | Jam kompilasi data per mitra per bulan | −20 jam/bulan per mitra | Log waktu mitra sebelum/sesudah |
| Mempercepat respons | Keputusan lapangan yang dipicu Horus | 10/bulan | Formulir singkat mitra |
| Memprioritaskan hutan & habitat | Hotspot deforestasi yang ditinjau | 200/tahun | Ekspor kartu/catatan mitra |
| Adopsi | Organisasi mitra aktif | ≥ 2 sebelum bulan ke-3, 4 di bulan ke-6 | Analytics + kontak |
| Biaya terkendali | Biaya infrastruktur | ≤ US$20/bulan | Tagihan Vercel + Cesium |

**Kriteria lanjut/berhenti** ditentukan JEV: bila SROI terukur < 1,0 di tahap
`operate`, fitur dihentikan atau dirancang ulang.

## 3. Pengguna

| Persona | Kebutuhan | Fitur utama |
| --- | --- | --- |
| Analis LSM (kehutanan, konservasi) | Melihat tekanan hutan dan habitat di sekitar kejadian | Deforestasi, flora/fauna, prioritas JEV |
| Staf BPBD/pemda | Tahu bencana aktif dan mana yang didahulukan | Bencana alam, titik api, prioritas JEV |
| Peneliti/jurnalis | Konteks visual dan sumber data yang bisa dikutip | Kartu dengan link laporan, kredit data |

## 4. Ruang lingkup

### 4.1 Sudah live (rilis 1)

| ID | Fitur | Sumber | Key |
| --- | --- | --- | --- |
| FR-01 | Globe dibuka di Indonesia; peta datar gratis sebagai default | Esri, Cesium World Terrain | Cesium (opsional) |
| FR-02 | Deforestasi 2001–2025 | Hansen/UMD/Google GFC v1.13 | — |
| FR-03 | Titik api VIIRS 375 m terbaru | NASA GIBS | — |
| FR-04 | Bencana alam aktif + kartu laporan | GDACS + NASA EONET | — |
| FR-05 | Habitat flora & fauna (kepadatan catatan) | GBIF | — |
| FR-06 | **Layer prioritas JEV**: ranking bencana × biodiversitas × tekanan hutan | GDACS, GBIF, GFC | — |
| FR-07 | Peta 3D Google Photorealistic, hanya saat dipilih | Cesium ion | Cesium |
| FR-08 | Layer warisan (pesawat, satelit, CCTV, cuaca, dll.) tetap ada, mati default | Beragam | Beragam |

### 4.2 Kebutuhan non-fungsional

| ID | Kebutuhan |
| --- | --- |
| NFR-01 | Halaman tampil < 5 detik di 4G; layer default tanpa key apa pun. |
| NFR-02 | Satu sumber gagal tidak mematikan layer lain; data basi ditandai `stale`. |
| NFR-03 | Biaya: tidak ada function yang berjalan > 15 detik dalam alur normal; tile dari CDN. |
| NFR-04 | Keamanan sesuai [SECURITY-AUDIT.md](SECURITY-AUDIT.md); key server tidak pernah dikirim ke browser kecuali token publik yang dibatasi URL. |
| NFR-05 | Setiap layer menampilkan sumber dan lisensi (`src/data/dataCredits.js`, `DATA_SOURCES.md`). |
| NFR-06 | Bahasa: EN/ES/RU/ZH lengkap; Bahasa Indonesia sebagai inisiatif berikutnya. |

### 4.3 Di luar lingkup (non-goals)

- Bukan sistem peringatan dini resmi. Skor prioritas adalah **heuristik triase**,
  bukan keputusan pemerintah. Ditulis di kartu dan legenda.
- "Deforestasi" = kehilangan tutupan pohon (termasuk panen HTI & bekas
  kebakaran), bukan deforestasi permanen terverifikasi.
- Peta flora/fauna = lokasi catatan spesies, bukan batas habitat resmi.
- Tidak melacak individu, wajah, atau orang (warisan aturan proyek asal).
- Tidak untuk penggunaan komersial selama lisensi data belum beres (D-07).

## 5. Metode skor prioritas JEV (FR-06)

`skor = 100 × (0,5·bahaya + 0,25·biodiversitas + 0,25·tekanan hutan)`

- **Bahaya**: level GDACS merah 1,0 · oranye 0,65 · hijau/tanpa level 0,35.
- **Biodiversitas**: `log10(n+1)/log10(10.001)`, n = catatan GBIF dalam ±50 km.
- **Tekanan hutan**: porsi area tile GFC (zoom 9, ±78 km) yang kehilangan pohon
  sejak 2001, jenuh di 25%.
- Faktor yang gagal diukur dikeluarkan dan bobot dinormalisasi ulang; kartu
  menandai "skor parsial".
- Tier: ≥70 **Critical**, ≥45 **High**, lainnya **Watch**.
- Cakupan: area `PRIORITY_AREA` (default 90–145°BT, 15°LS–25°LU), maks. 60
  kejadian, cache 30 menit.

Bobot di `src/jev/priority.js`. Perubahan bobot = perubahan produk → lewat JEV.

## 6. Risiko utama

Dikelola sebagai register risiko di tiap inisiatif JEV. Yang terpenting:
perubahan API hulu (GDACS/EONET/GBIF), salah tafsir skor sebagai resmi, kuota
Cesium, dan lisensi non-komersial. Rincian di
[jev/DECISIONS.md](jev/DECISIONS.md) dan [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

## 7. Rilis berikutnya (kandidat, menunggu JEV)

| Inisiatif | Verdict JEV terkini | Syarat |
| --- | --- | --- |
| Bahasa Indonesia | lihat DECISIONS | Butuh bukti pengguna non-Inggris |
| FIRMS detail (klik titik api) | lihat DECISIONS | Butuh host yang bisa menjangkau FIRMS |
| SaaS komersial | NO-GO | Lisensi data |
