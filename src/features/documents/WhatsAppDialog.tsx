import { useEffect, useState } from 'react';
import { ExternalLink, FileDown, FolderOpen, Plus, Save, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes, formatDateTime } from '@/lib/utils';
import { api } from '@/services/api';
import { DELIVERY_STATUS_LABEL, formatWaPhone, inviteMessage, normalizeWaPhone, type DeliveryLog, type WaTarget } from '@shared/whatsapp';
import type { ExportDoc } from '@shared/types';

interface Row { name: string; organization: string; phone: string }
interface Source { id?: string | null; recipient: string; subject: string; letter_number: string; form_values: Record<string, string> }
const TONE: Record<string, 'amber' | 'green' | 'red' | 'navy'> = { whatsapp_opened: 'amber', submitted: 'navy', sent: 'green', delivered: 'green', read: 'green', failed: 'red' };

/**
 * Kirim surat undangan lewat WhatsApp. Mode utama: click-to-chat (Desktop/Web) dengan pesan terisi; PDF dibuat otomatis di folder aplikasi
 * dan dilampirkan sendiri oleh pengguna. Aplikasi hanya tahu chat dibuka, jadi tidak pernah menulis "terkirim" untuk mode ini.
 * Mode Business API (bila diaktifkan administrator) mengirim PDF langsung; status terkirim/dibaca hanya dari konfirmasi WhatsApp.
 */
export function WhatsAppDialog({ source, exportDoc }: { source: Source; exportDoc: () => ExportDoc }) {
  if (!source.id) return <DialogContent title="Kirim via WhatsApp"><p className="text-sm">Simpan dokumen dulu agar penerima dan riwayat pengiriman tercatat pada surat ini.</p></DialogContent>;
  return <Sender documentId={source.id} source={source} exportDoc={exportDoc} />;
}

function Sender({ documentId, source, exportDoc }: { documentId: string; source: Source; exportDoc: () => ExportDoc }) {
  const { toast, confirm } = useFeedback();
  const fv = source.form_values;
  const data = useAsync(() => api.whatsapp.recipients(documentId), [documentId]);
  const cloud = useAsync(() => api.whatsapp.cloudStatus(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [text, setText] = useState(() => inviteMessage({
    recipient: '', subject: fv.PERIHAL || source.subject, number: fv.NOMOR_SURAT || source.letter_number,
    date: fv.TANGGAL_ACARA, time: fv.WAKTU, place: fv.LOKASI, agenda: fv.AGENDA
  }));
  const [method, setMethod] = useState<WaTarget | 'api'>('desktop');
  const [pdf, setPdf] = useState<{ path: string; name: string; size: number; sha256: string } | null>(null);
  const [pdfErr, setPdfErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.whatsapp.preparePdf(exportDoc()).then(setPdf).catch((e) => setPdfErr(errMsg(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data.data && rows === null) setRows(data.data.recipients.length ? data.data.recipients.map(({ name, organization, phone }) => ({ name, organization, phone }))
      : [{ name: fv.TUJUAN_SURAT || source.recipient || '', organization: '', phone: '' }]);
  }, [data.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = data.data?.history ?? [];
  const latest = (phone: string | null): DeliveryLog | undefined => (phone ? history.find((h) => h.phone === phone) : undefined);
  const setRow = (i: number, p: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const personal = (name: string) => text.replace(/^Yth\. [^,\n]*,/, `Yth. ${name.trim() || 'Bapak/Ibu'},`);
  const saveList = async () => {
    try { await api.whatsapp.saveRecipients(documentId, rows!); data.reload(); toast('Daftar penerima disimpan.', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
  };

  const send = async (r: Row) => {
    const phone = normalizeWaPhone(r.phone)!;
    const who = r.name || formatWaPhone(phone);
    const prev = latest(phone);
    const api_ = method === 'api';
    const ok = await confirm({
      title: prev && prev.status !== 'failed' ? `Kirim lagi ke ${who}?` : api_ ? `Kirim PDF ke ${who} lewat WhatsApp Business API?` : `Buka WhatsApp untuk ${who}?`,
      confirmLabel: prev && prev.status !== 'failed' ? 'Ya, kirim lagi' : api_ ? 'Kirim' : 'Buka WhatsApp',
      message: <>
        {prev && prev.status !== 'failed' && <p className="mb-2 font-medium text-amber-800">Riwayat: {DELIVERY_STATUS_LABEL[prev.status]} pada {formatDateTime(prev.created_at)}. Melanjutkan bisa membuat undangan diterima dua kali.</p>}
        {api_ ? <p>PDF {pdf?.name} dikirim langsung ke {formatWaPhone(phone)}. Status terkirim/dibaca muncul bila WhatsApp mengonfirmasi.</p>
          : <p>Pesan akan terisi otomatis. <b>Lampirkan PDF secara manual</b>, lalu tekan Kirim di WhatsApp. Aplikasi tidak dapat melampirkan PDF atau memastikan pesan terkirim.</p>}
      </>
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (api_) await api.whatsapp.cloudSend({ document_id: documentId, phone, recipient: r.name, caption: personal(r.name), pdf_path: pdf!.path });
      else await api.whatsapp.open({ phone, text: personal(r.name), target: method, recipient: r.name, document_id: documentId, pdf_sha256: pdf?.sha256 ?? null });
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); data.reload(); }
  };

  return (
    <DialogContent wide title="Kirim via WhatsApp" description="Pilih penerima, periksa pesan, lalu buka WhatsApp. Riwayat tercatat pada surat ini.">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <FileDown size={16} className="text-slate-500" />
          {pdf ? <>
            <span className="font-medium">{pdf.name}</span><span className="text-slate-500">{formatBytes(pdf.size)}</span>
            <Button size="sm" variant="outline" onClick={() => api.whatsapp.openPdf(pdf.path).catch((e) => toast(errMsg(e), 'error'))}><ExternalLink size={14} /> Pratinjau PDF</Button>
            <Button size="sm" variant="outline" onClick={() => api.showInFolder(pdf.path).catch((e) => toast(errMsg(e), 'error'))}><FolderOpen size={14} /> Tampilkan di folder</Button>
          </> : pdfErr ? <span className="text-red-700" role="alert">PDF gagal dibuat: {pdfErr}</span> : <span className="text-slate-500">Menyiapkan PDF…</span>}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between"><span className="font-medium">Penerima</span>
            <Button size="sm" variant="ghost" disabled={!rows} onClick={saveList}><Save size={14} /> Simpan daftar penerima</Button></div>
          {data.error && <p className="text-red-700">{data.error}</p>}
          <table className="w-full"><tbody>{rows?.map((r, i) => {
            const ok = normalizeWaPhone(r.phone); const last = latest(ok);
            return (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2"><Input aria-label={`Nama penerima ${i + 1}`} placeholder="Nama/jabatan" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} /></td>
                <td className="py-1 pr-2"><Input aria-label={`Instansi ${i + 1}`} placeholder="Instansi (opsional)" value={r.organization} onChange={(e) => setRow(i, { organization: e.target.value })} /></td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Nomor WhatsApp ${i + 1}`} placeholder="0812-3456-7890" inputMode="tel" value={r.phone} onChange={(e) => setRow(i, { phone: e.target.value })} />
                  {r.phone && <div className={ok ? 'text-xs text-slate-500' : 'text-xs text-red-700'}>{ok ? formatWaPhone(ok) : 'Nomor tidak valid'}</div>}
                </td>
                <td className="whitespace-nowrap py-1 pr-2">{last ? <Badge tone={TONE[last.status]}>{DELIVERY_STATUS_LABEL[last.status]}</Badge> : <Badge>{ok ? 'Siap dikirim' : 'Draf'}</Badge>}</td>
                <td className="whitespace-nowrap py-1 text-right">
                  <Button size="sm" disabled={!ok || !text.trim() || busy || (method === 'api' && !pdf)} onClick={() => send(r)}><Send size={14} /> {method === 'api' ? 'Kirim' : 'Buka WhatsApp'}</Button>
                  {rows.length > 1 && <Button size="icon" variant="ghost" aria-label="Hapus penerima" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>}
                </td>
              </tr>
            );
          })}</tbody></table>
          <Button size="sm" variant="ghost" disabled={!rows} onClick={() => setRows([...rows!, { name: '', organization: '', phone: '' }])}><Plus size={14} /> Tambah penerima</Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <Field label="Pesan pengantar" hint="Baris 'Yth.' diganti nama tiap penerima."><Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Metode">
            <Select value={method} onChange={(e) => setMethod(e.target.value as WaTarget | 'api')}>
              <option value="desktop">WhatsApp Desktop (lampirkan PDF sendiri)</option>
              <option value="web">WhatsApp Web (lampirkan PDF sendiri)</option>
              {cloud.data?.enabled && <option value="api">WhatsApp Business API (PDF terlampir)</option>}
            </Select>
          </Field>
        </div>

        {!!history.length && (
          <div>
            <div className="mb-1 font-medium">Riwayat pengiriman</div>
            <div className="max-h-40 overflow-auto rounded border border-slate-200">
              <table className="w-full text-xs"><tbody>{history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">{formatDateTime(h.created_at)}</td><td className="px-2 py-1">{h.recipient_name || '-'}</td><td className="px-2 py-1">{formatWaPhone(h.phone)}</td>
                  <td className="px-2 py-1">{h.method === 'cloud_api' ? 'Business API' : h.method === 'wa_web' ? 'WhatsApp Web' : 'WhatsApp Desktop'}</td>
                  <td className="px-2 py-1"><Badge tone={TONE[h.status]}>{DELIVERY_STATUS_LABEL[h.status]}</Badge>{h.error && <span className="ml-1 text-red-700">{h.error}</span>}</td>
                  <td className="px-2 py-1">{h.actor_name}</td>
                </tr>))}</tbody></table>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500">"WhatsApp dibuka" hanya berarti chat terbuka dengan pesan terisi. Terkirim, sampai, dan dibaca hanya tercatat bila WhatsApp Business API mengonfirmasi.</p>
      </div>
    </DialogContent>
  );
}
