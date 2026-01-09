# Si Pemban — Lapor Banjir Kalbar (Front-end Only)

Aplikasi sederhana offline-first untuk mencatat curah hujan (mm/hari) per wilayah di Kalimantan Barat dan menghitung status risiko (Normal/Waspada/Siaga/Awas) berbasis ambang yang bisa diatur.

## Fitur
- SPA (hash route): #/home, #/new, #/data, #/analytics, #/settings
- Offline-first: data tersimpan localStorage
- Grafik donut + line chart (tanpa library)
- Export/Import JSON + Export CSV
- Ambil GPS (opsional, jika diizinkan browser)
- PWA (manifest + service worker)

## Jalankan Lokal
Cara paling gampang (tanpa tooling):
- Buka file `index.html` langsung (double click), atau
- Pakai VSCode Live Server (disarankan) agar SW/PWA stabil.

## Deploy ke Vercel
1. Push repo ke GitHub
2. Vercel -> New Project -> Import repo
3. Framework Preset: Other
4. Build Command: (kosong)
5. Output Directory: (kosong / default)
6. Deploy

`vercel.json` sudah disiapkan untuk rewrite ke index.html.
