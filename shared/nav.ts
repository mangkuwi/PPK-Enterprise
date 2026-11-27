/**
 * Struktur menu aplikasi. Satu menu = satu "bagian"; halaman lama yang digabung menjadi tab di bagian itu,
 * sehingga tidak ada rute atau fitur yang hilang.
 */
export interface NavTab { to: string; label: string }
export interface NavSection { key: string; label: string; to: string; tabs: NavTab[]; match: string[] }
export interface NavGroup { label: string | null; sections: string[] }

const sec = (key: string, label: string, to: string, match: string[], tabs: NavTab[] = []): NavSection => ({ key, label, to, match, tabs });

export const SECTIONS: NavSection[] = [
  sec('dashboard', 'Dashboard', '/', []),
  sec('agenda', 'Agenda & Rapat', '/ppk/agenda', ['/ppk/agenda', '/ppk/kotak-masuk'], [
    { to: '/ppk/agenda', label: 'Agenda' }, { to: '/ppk/kotak-masuk', label: 'Kotak Masuk WhatsApp' }]),
  sec('buat', 'Buat Surat / Dokumen', '/generator', ['/generator']),
  sec('dokumen', 'Dokumen & Arsip', '/archive', ['/archive', '/documents'], [
    { to: '/archive', label: 'Semua' }, { to: '/archive?status=draft', label: 'Draf & Riwayat' }, { to: '/archive?status=final', label: 'Final (Arsip)' }]),
  sec('template', 'Template', '/templates', ['/templates', '/importer'], [
    { to: '/templates', label: 'Daftar Template' }, { to: '/importer', label: 'Impor Template' }, { to: '/importer/review', label: 'Analisis & Mapping' },
    { to: '/importer/preview', label: 'Preview' }, { to: '/importer/templates', label: 'Template Terimpor' }, { to: '/importer/history', label: 'Riwayat Impor' }]),
  sec('bank', 'Bank Nomor', '/bank-nomor', ['/bank-nomor']),
  sec('register', 'Register Nomor Surat', '/register/surat-keluar', ['/register', '/penomoran/impor', '/penomoran$'], [
    { to: '/register/surat-keluar', label: 'Surat Keluar' }, { to: '/register/nota-dinas', label: 'Nota Dinas' }, { to: '/register/berita-acara', label: 'Berita Acara' },
    { to: '/register/kontrak', label: 'Kontrak' }, { to: '/penomoran', label: 'Ringkasan' }, { to: '/penomoran/impor', label: 'Impor Excel' }]),
  sec('kontrak', 'Kontrak', '/ppk/kontrak', ['/ppk/kontrak']),
  sec('tagihan', 'Tagihan & Pembayaran', '/ppk/tagihan', ['/ppk/tagihan', '/ppk/rekonsiliasi'], [
    { to: '/ppk/tagihan', label: 'Tagihan & Pembayaran' }, { to: '/ppk/rekonsiliasi', label: 'Rekonsiliasi SP2D' }]),
  sec('anggaran', 'Anggaran', '/ppk/anggaran', ['/ppk/anggaran', '/ppk/impor'], [
    { to: '/ppk/anggaran', label: 'Database Anggaran' }, { to: '/ppk/impor', label: 'Impor Excel' }]),
  sec('penyedia', 'Penyedia', '/ppk/penyedia', ['/ppk/penyedia']),
  sec('prognosis', 'Monitoring & Prognosis', '/ppk/laporan', ['/ppk/laporan']),
  sec('pengaturan', 'Pengaturan', '/settings', ['/settings', '/penomoran/pengaturan', '/ppk/pengaturan', '/ppk/server'], [
    { to: '/settings', label: 'Umum' }, { to: '/penomoran/pengaturan', label: 'Penomoran & Pengguna' }, { to: '/ppk/pengaturan', label: 'PPK' }, { to: '/ppk/server', label: 'Server PPK' }])
];

export const GROUPS: NavGroup[] = [
  { label: null, sections: ['dashboard', 'agenda'] },
  { label: 'Administrasi Dokumen', sections: ['buat', 'dokumen', 'template'] },
  { label: 'Nomor Surat', sections: ['bank', 'register'] },
  { label: 'Kontraktual', sections: ['kontrak', 'tagihan'] },
  { label: 'Database', sections: ['anggaran', 'penyedia'] },
  { label: null, sections: ['prognosis', 'pengaturan'] }
];

export const sectionByKey = (key: string) => SECTIONS.find((s) => s.key === key)!;

/** Bagian yang memuat path ini. Pola diakhiri `$` = path persis; selain itu awalan per segmen. */
export function sectionFor(pathname: string): NavSection | null {
  if (pathname === '/') return sectionByKey('dashboard');
  let best: NavSection | null = null; let len = 0;
  for (const s of SECTIONS) for (const m of s.match) {
    const exact = m.endsWith('$'); const p = exact ? m.slice(0, -1) : m;
    const hit = exact ? pathname === p : pathname === p || pathname.startsWith(`${p}/`);
    if (hit && p.length > len) { best = s; len = p.length; }
  }
  return best;
}

/** Tab aktif: path + query harus cocok; tab tanpa query cocok bila path sama dan tidak ada tab lain yang lebih spesifik. */
export function activeTab(s: NavSection, pathname: string, search: string): string | null {
  const q = new URLSearchParams(search);
  const exact = s.tabs.find((t) => { const [p, tq] = t.to.split('?'); return p === pathname && !!tq && [...new URLSearchParams(tq)].every(([k, v]) => q.get(k) === v); });
  if (exact) return exact.to;
  const plain = s.tabs.filter((t) => !t.to.includes('?') && (t.to === pathname || pathname.startsWith(`${t.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return plain?.to ?? null;
}
