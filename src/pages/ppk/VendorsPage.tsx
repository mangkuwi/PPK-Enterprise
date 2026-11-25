import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Download, Pencil, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { api } from '@/services/api';
import { VENDOR_STATUS_LABEL, type Vendor, type VendorInput, type VendorStatus } from '@shared/ppk/vendors';

const EMPTY: VendorInput = { name: '', npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '', bank_name: '', account_number: '', account_holder: '', service_category_id: null, notes: '' };
const TONE: Record<VendorStatus, 'green' | 'slate' | 'amber'> = { aktif: 'green', nonaktif: 'amber', arsip: 'slate' };
const npwpText = (d: string) => (d.length === 15 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d)(\d{3})(\d{3})$/, '$1.$2.$3.$4-$5.$6') : d);

export default function VendorsPage() {
  const { can } = usePpkAccess();
  const { toast, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<VendorStatus | 'semua'>('aktif');
  const q = useDebounced(search);
  const list = useAsync(() => api.ppk.vendors.list({ search: q, status }), [q, status]);
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null);

  const toggleArchive = async (v: Vendor) => {
    const to: VendorStatus = v.status === 'arsip' ? 'aktif' : 'arsip';
    if (!(await confirm({ title: to === 'arsip' ? 'Arsipkan penyedia?' : 'Aktifkan kembali?', message: `${v.name} ${to === 'arsip' ? 'tidak akan muncul di daftar aktif. Riwayatnya tetap tersimpan.' : 'akan muncul lagi di daftar aktif.'}` }))) return;
    try { await api.ppk.vendors.setStatus(v.id, to, ''); toast('Status penyedia diperbarui.', 'success'); list.reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const exportXlsx = async () => {
    try { const r = await api.ppk.vendors.exportXlsx(status); if (!r.canceled) toast(`Tersimpan: ${r.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Database Penyedia" subtitle="Satu data penyedia untuk kontrak, tagihan, dan pembayaran."
          actions={<>
            <Button variant="outline" onClick={exportXlsx}><Download size={16} />Ekspor Excel</Button>
            {can('write') && <Button onClick={() => setEdit('new')}><Plus size={16} />Tambah Penyedia</Button>}
          </>} />
        <div className="mb-4 flex flex-wrap gap-3">
          <Input className="max-w-sm" placeholder="Cari nama, NPWP, NIB, atau kontak" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari penyedia" />
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as VendorStatus | 'semua')} aria-label="Filter status">
            <option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option><option value="arsip">Diarsipkan</option><option value="semua">Semua status</option>
          </Select>
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Belum ada penyedia{search ? ' yang cocok dengan pencarian' : ''}.</Empty>}
        {!!list.data?.length && (
          <Card className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Nama penyedia</th><th className="px-3 py-2 text-left">NPWP</th><th className="px-3 py-2 text-left">Kategori</th>
                <th className="px-3 py-2 text-left">Kontak</th><th className="px-3 py-2 text-left">Bank</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Aksi</th>
              </tr></thead>
              <tbody>{list.data.map((v) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-navy-900">{v.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{npwpText(v.npwp) || '—'}</td>
                  <td className="px-3 py-2">{v.service_category_name ?? '—'}</td>
                  <td className="px-3 py-2">{[v.contact_person, v.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2">{v.bank_name ? `${v.bank_name} ${v.account_number}` : '—'}</td>
                  <td className="px-3 py-2"><Badge tone={TONE[v.status]}>{VENDOR_STATUS_LABEL[v.status]}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {can('write') && <>
                      <Button size="icon" variant="ghost" aria-label={`Ubah ${v.name}`} title="Ubah" onClick={() => setEdit(v)}><Pencil size={15} /></Button>
                      <Button size="icon" variant="ghost" aria-label={v.status === 'arsip' ? `Aktifkan ${v.name}` : `Arsipkan ${v.name}`} title={v.status === 'arsip' ? 'Aktifkan' : 'Arsipkan'} onClick={() => toggleArchive(v)}>
                        {v.status === 'arsip' ? <ArchiveRestore size={15} /> : <Archive size={15} />}</Button>
                    </>}
                  </td>
                </tr>))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-3 text-xs text-slate-500">Riwayat kontrak, tagihan, dan pembayaran per penyedia tampil di sini setelah modul kontrak dan tagihan selesai.</p>
        {edit && <VendorDialog vendor={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      </PpkGate>
    </Page>
  );
}

function VendorDialog({ vendor, onClose, onSaved }: { vendor: Vendor | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [v, setV] = useState<VendorInput>(() => (vendor ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, (vendor as any)[k] ?? (k === 'service_category_id' ? null : '')])) } as VendorInput : EMPTY));
  const [busy, setBusy] = useState(false);
  const cats = useAsync(() => api.ppk.masterList('service_categories'), []);
  const name = useDebounced(v.name, 400); const npwp = useDebounced(v.npwp, 400);
  const [similar, setSimilar] = useState<Array<{ id: string; name: string; status: VendorStatus; score: number }>>([]);
  useEffect(() => {
    if (name.trim().length < 3 && !npwp) { setSimilar([]); return; }
    api.ppk.vendors.similar(name, npwp, vendor?.id).then(setSimilar).catch(() => setSimilar([]));
  }, [name, npwp, vendor?.id]);
  const set = (k: keyof VendorInput) => (e: { target: { value: string } }) => setV({ ...v, [k]: k === 'service_category_id' ? e.target.value || null : e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      if (vendor) await api.ppk.vendors.update(vendor.id, vendor.version, v); else await api.ppk.vendors.create(v);
      toast(vendor ? 'Penyedia diperbarui.' : 'Penyedia ditambahkan.', 'success'); onSaved();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={vendor ? `Ubah Penyedia — ${vendor.name}` : 'Tambah Penyedia'} description="NPWP dan nama dipakai untuk mencegah penyedia ganda."
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy || !v.name.trim()} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        {!!similar.length && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            Penyedia yang mirip sudah ada: {similar.map((x) => `${x.name}${x.status !== 'aktif' ? ` (${VENDOR_STATUS_LABEL[x.status]})` : ''}`).join(', ')}. Pastikan ini bukan penyedia yang sama.
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nama perusahaan" required className="md:col-span-2"><Input value={v.name} onChange={set('name')} autoFocus /></Field>
          <Field label="NPWP" hint="15 atau 16 digit; titik dan strip boleh"><Input value={v.npwp} onChange={set('npwp')} inputMode="numeric" /></Field>
          <Field label="NIB"><Input value={v.nib} onChange={set('nib')} /></Field>
          <Field label="Alamat" className="md:col-span-2"><Textarea value={v.address} onChange={set('address')} /></Field>
          <Field label="Kontak (nama)"><Input value={v.contact_person} onChange={set('contact_person')} /></Field>
          <Field label="Telepon"><Input value={v.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input type="email" value={v.email} onChange={set('email')} /></Field>
          <Field label="Kategori layanan" hint="Atur daftarnya di Pengaturan PPK">
            <Select value={v.service_category_id ?? ''} onChange={set('service_category_id')}>
              <option value="">— Tidak ada —</option>
              {cats.data?.filter((c) => c.is_active || c.id === v.service_category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Bank"><Input value={v.bank_name} onChange={set('bank_name')} /></Field>
          <Field label="Nomor rekening"><Input value={v.account_number} onChange={set('account_number')} inputMode="numeric" /></Field>
          <Field label="Atas nama rekening" className="md:col-span-2"><Input value={v.account_holder} onChange={set('account_holder')} /></Field>
          <Field label="Catatan" className="md:col-span-2"><Textarea value={v.notes} onChange={set('notes')} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
