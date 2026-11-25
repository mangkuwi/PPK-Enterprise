import { useEffect, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import { formatBytes, formatDateTime, readFileAsDataUrl } from '@/lib/utils';
import { FONT_FAMILIES } from '@shared/settings';
import type { BackupType } from '@shared/types';

const BACKUP_LABEL: Record<string, string> = { full: 'Backup lengkap', templates: 'Template', documents: 'Arsip dokumen', 'pre-restore': 'Otomatis (sebelum restore)' };

export default function SettingsPage() {
  const { settings, update, refresh } = useSettings();
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState<Record<string, string>>(settings);
  const [busy, setBusy] = useState('');
  const [aiKey, setAiKey] = useState('');
  const history = useAsync(() => api.backup.history(), []);
  const info = useAsync(() => api.info(), []);
  useEffect(() => setForm(settings), [settings]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const guard = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); } };

  const save = () => guard('save', async () => {
    const { ai_key_set: _k, ...rest } = form;
    await update(rest);
    toast('Pengaturan tersimpan.', 'success');
  });

  const chooseDir = (purpose: 'export' | 'backup') => guard('dir', async () => {
    const r = await api.settings.chooseDir(purpose);
    if (!r.canceled) { await refresh(); toast('Folder disimpan.', 'success'); }
  });

  const logo = (f?: File) => guard('logo', async () => { if (f) set('institution_logo', await readFileAsDataUrl(f, 1024 * 1024)); });

  const backup = (type: BackupType) => guard(`b-${type}`, async () => {
    const r = await api.backup.create(type);
    toast(`Backup tersimpan (${formatBytes(r.size)}): ${r.path}`, 'success', { label: 'Buka folder', run: () => { api.showInFolder(r.path).catch((e) => toast(errMsg(e), 'error')); } });
    history.reload();
  });

  const restore = async () => {
    const ok = await confirm({ title: 'Restore backup?', confirmLabel: 'Pilih berkas backup', destructive: true,
      message: 'Anda akan memilih berkas backup (.zip). Untuk backup lengkap, seluruh data saat ini diganti; salinan otomatis data saat ini dibuat lebih dulu. Konfirmasi akhir akan ditampilkan setelah berkas dipilih.' });
    if (!ok) return;
    await guard('restore', async () => {
      const r = await api.backup.restore();
      if (r.canceled) return;
      if (r.type === 'full') return; // jendela dimuat ulang oleh proses utama
      toast(`Restore selesai: ${r.imported ?? 0} item digabungkan.`, 'success');
      history.reload();
    });
  };

  const saveKey = (key: string) => guard('key', async () => { await api.settings.setAiKey(key); setAiKey(''); await refresh(); toast(key ? 'Kunci API disimpan terenkripsi.' : 'Kunci API dihapus.', 'success'); });

  return (
    <Page>
      <PageHeader title="Pengaturan" subtitle="Semua pengaturan tersimpan lokal di perangkat ini." actions={<Button onClick={save} disabled={busy === 'save'}>Simpan Pengaturan</Button>} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-navy-900">Instansi & Kop Surat</h2>
          <Field label="Nama instansi"><Input value={form.institution_name ?? ''} onChange={(e) => set('institution_name', e.target.value)} /></Field>
          <Field label="Alamat" hint="Satu baris per alamat/kontak"><Textarea value={form.institution_address ?? ''} onChange={(e) => set('institution_address', e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            {form.institution_logo ? <img src={form.institution_logo} alt="Logo" className="h-16 w-16 rounded border object-contain" /> : <div className="grid h-16 w-16 place-items-center rounded border border-dashed text-xs text-slate-400">Logo</div>}
            <label className="cursor-pointer"><span className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"><Upload size={15} /> Unggah logo</span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/bmp" className="hidden" onChange={(e) => { logo(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {form.institution_logo && <Button variant="ghost" size="sm" onClick={() => set('institution_logo', '')}>Hapus logo</Button>}
          </div>
          <Switch checked={form.kop_enabled === 'true'} onChange={(v) => set('kop_enabled', String(v))} label="Tampilkan kop surat pada halaman pertama dokumen" />
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-navy-900">Identitas Pengirim Default</h2>
          <p className="text-xs text-slate-500">Mengisi otomatis placeholder [PENGIRIM], [NAMA_PEJABAT], dan [JABATAN_PEJABAT] pada formulir.</p>
          <Field label="Pengirim (unit/jabatan)"><Input value={form.sender_identity ?? ''} onChange={(e) => set('sender_identity', e.target.value)} /></Field>
          <Field label="Jabatan pejabat"><Input value={form.official_title ?? ''} onChange={(e) => set('official_title', e.target.value)} /></Field>
          <Field label="Nama pejabat"><Input value={form.official_name ?? ''} onChange={(e) => set('official_name', e.target.value)} /></Field>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-navy-900">Default Dokumen Baru</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Font"><Select value={form.default_font ?? 'Arial'} onChange={(e) => set('default_font', e.target.value)}>{FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}</Select></Field>
            <Field label="Ukuran (pt)"><Input type="number" value={form.default_font_size ?? '12'} onChange={(e) => set('default_font_size', e.target.value)} /></Field>
            <Field label="Spasi baris"><Input type="number" step={0.05} value={form.line_height ?? '1.15'} onChange={(e) => set('line_height', e.target.value)} /></Field>
            <div />
            <Field label="Margin atas (mm)"><Input type="number" value={form.margin_top ?? ''} onChange={(e) => set('margin_top', e.target.value)} /></Field>
            <Field label="Margin bawah (mm)"><Input type="number" value={form.margin_bottom ?? ''} onChange={(e) => set('margin_bottom', e.target.value)} /></Field>
            <Field label="Margin kiri (mm)"><Input type="number" value={form.margin_left ?? ''} onChange={(e) => set('margin_left', e.target.value)} /></Field>
            <Field label="Margin kanan (mm)"><Input type="number" value={form.margin_right ?? ''} onChange={(e) => set('margin_right', e.target.value)} /></Field>
          </div>
          <Switch checked={form.show_page_number === 'true'} onChange={(v) => set('show_page_number', String(v))} label="Nomor halaman di footer" />
          <p className="text-xs text-slate-500">Berlaku untuk template/dokumen baru; dokumen yang sudah ada tidak berubah.</p>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-navy-900">Lokasi Penyimpanan</h2>
          <Field label="Folder export default" hint="Folder awal pada dialog simpan DOCX/PDF">
            <div className="flex gap-2"><Input readOnly value={form.export_dir || '(Dokumen pengguna)'} /><Button variant="outline" onClick={() => chooseDir('export')}><FolderOpen size={15} /> Pilih</Button></div></Field>
          <Field label="Folder backup">
            <div className="flex gap-2"><Input readOnly value={form.backup_dir || '(Folder bawaan aplikasi)'} /><Button variant="outline" onClick={() => chooseDir('backup')}><FolderOpen size={15} /> Pilih</Button></div></Field>
          <p className="text-xs text-slate-500 break-all">Database: {info.data?.dbPath}</p>
        </Card>

        <Card className="space-y-3 p-4 xl:col-span-2">
          <h2 className="font-semibold text-navy-900">Backup & Restore</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => backup('full')} disabled={!!busy}>Backup Lengkap (database)</Button>
            <Button variant="outline" onClick={() => backup('templates')} disabled={!!busy}>Backup Template</Button>
            <Button variant="outline" onClick={() => backup('documents')} disabled={!!busy}>Backup Arsip Dokumen</Button>
            <Button variant="destructive" onClick={restore} disabled={!!busy}>Restore dari Backup…</Button>
          </div>
          <p className="text-xs text-slate-500">Berkas backup (.zip) dapat dipindahkan ke komputer Windows lain lalu di-restore dari menu ini.</p>
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Waktu</th><th>Jenis</th><th>Ukuran</th><th>Lokasi</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.data?.map((h) => <tr key={h.id}><td className="py-1.5 whitespace-nowrap">{formatDateTime(h.created_at)}</td><td>{BACKUP_LABEL[h.type] ?? h.type}</td><td>{formatBytes(h.size_bytes)}</td><td className="break-all text-xs text-slate-500">{h.path}</td></tr>)}
              {history.data?.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-500">Belum ada backup.</td></tr>}
            </tbody></table>
        </Card>

        <Card className="space-y-3 p-4 xl:col-span-2">
          <h2 className="font-semibold text-navy-900">Asisten AI (opsional)</h2>
          <p className="text-xs text-slate-500">Nonaktif secara bawaan. Seluruh fitur inti berjalan tanpa AI dan tanpa internet. Bila diaktifkan, teks <b>hanya</b> dikirim ke endpoint yang Anda isi di bawah, dan setiap pengiriman meminta persetujuan eksplisit. AI dilarang mengarang nomor surat, dasar hukum, nama/jabatan pejabat, tanggal, anggaran, atau informasi kontraktual.</p>
          <Switch checked={form.ai_enabled === 'true'} onChange={(v) => set('ai_enabled', String(v))} label="Aktifkan asisten AI" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Endpoint (chat completions, kompatibel OpenAI)" hint="Harus HTTPS (HTTP hanya untuk localhost)"><Input placeholder="https://…/v1/chat/completions" value={form.ai_endpoint ?? ''} onChange={(e) => set('ai_endpoint', e.target.value)} /></Field>
            <Field label="Model"><Input value={form.ai_model ?? ''} onChange={(e) => set('ai_model', e.target.value)} /></Field>
          </div>
          <Field label="Kunci API" hint={settings.ai_key_set === 'true' ? 'Kunci tersimpan terenkripsi (DPAPI). Isi untuk mengganti.' : 'Disimpan terenkripsi lewat penyimpanan aman Windows; tidak pernah ditampilkan kembali.'}>
            <div className="flex gap-2"><Input type="password" autoComplete="off" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={settings.ai_key_set === 'true' ? '••••••••' : 'sk-…'} />
              <Button variant="outline" disabled={!aiKey} onClick={() => saveKey(aiKey)}>Simpan kunci</Button>
              {settings.ai_key_set === 'true' && <Button variant="ghost" onClick={() => saveKey('')}>Hapus</Button>}</div></Field>
        </Card>
      </div>
    </Page>
  );
}
