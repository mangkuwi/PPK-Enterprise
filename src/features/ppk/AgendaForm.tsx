import { Fragment, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateID } from '@shared/date';
import { dayName, type Agenda, type AgendaConflict, type AgendaInput } from '@shared/ppk/agenda';
import { AGENDA_MESSAGE_LABEL, matchProgram, type AgendaMessage } from '@shared/ppk/agendaMessage';

/** ' (6 jam)' / ' (1 jam 30 menit)'; kosong bila jam selesai tidak setelah jam mulai. */
const duration = (a: string, b: string) => {
  const m = b && a ? (Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5))) : 0;
  return m > 0 ? ` (${[Math.floor(m / 60) && `${Math.floor(m / 60)} jam`, m % 60 && `${m % 60} menit`].filter(Boolean).join(' ')})` : '';
};

/** Formulir agenda (baru dari surat undangan, atau ubah). Penanggung jawab dipilih dari pengguna yang punya peran PPK. */
export function AgendaForm({ initial, existing, parsed, onSaved }: { initial: AgendaInput; existing?: Agenda; parsed?: AgendaMessage | null; onSaved: (a: Agenda) => void }) {
  const { toast } = useFeedback();
  const people = useAsync(() => api.ppk.agendas.people(), []);
  const programs = useAsync(() => api.ppk.masterList('programs'), []);
  const [v, setV] = useState<AgendaInput>(initial);
  useEffect(() => { // Program dari pesan AGENDA PPK: isi hanya bila cocok persis dan staf belum memilih
    if (parsed?.program && programs.data) { const id = matchProgram(parsed.program, programs.data as Array<{ id: string }>); if (id) setV((x) => (x.program_id ? x : { ...x, program_id: id })); }
  }, [parsed, programs.data]);
  const [clash, setClash] = useState<AgendaConflict[]>([]);
  const staff = [...(v.pic_user_id ? [v.pic_user_id] : []), ...v.support_user_ids].join(',');
  useEffect(() => { // peringatan bentrok, tidak memblokir simpan
    if (!v.agenda_date || !v.start_time) { setClash([]); return; }
    const t = setTimeout(() => { api.ppk.agendas.conflicts({ agenda_date: v.agenda_date, start_time: v.start_time, end_time: v.end_time, exclude_id: existing?.id, user_ids: staff ? staff.split(',') : [] })
      .then(setClash, () => setClash([])); }, 300);
    return () => clearTimeout(t);
  }, [v.agenda_date, v.start_time, v.end_time, staff, existing?.id]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AgendaInput>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const toggle = (id: string) => setV({ ...v, support_user_ids: v.support_user_ids.includes(id) ? v.support_user_ids.filter((x) => x !== id) : [...v.support_user_ids, id] });
  const save = async () => {
    setBusy(true);
    try { onSaved(existing ? await api.ppk.agendas.update(existing.id, existing.version, v) : await api.ppk.agendas.create(v)); toast(existing ? 'Agenda diperbarui.' : 'Agenda dibuat dan tampil di Agenda PPK.', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <DialogContent wide title={existing ? 'Ubah agenda' : 'Buat agenda'} description={v.invitation_id && !existing ? 'Dari undangan masuk. Buka file undangan dan cocokkan isinya; menyimpan berarti Anda memverifikasi undangan ini.' : 'Periksa sebelum menyimpan. Agenda tidak bergantung pada pengiriman WhatsApp.'}
      footer={<Button disabled={busy} onClick={save}>{existing ? 'Simpan perubahan' : 'Simpan agenda'}</Button>}>
      {people.error && <p className="mb-2 text-sm text-red-700" role="alert">{people.error}</p>}
      {parsed && <ParsedBox m={parsed} programMatched={!!v.program_id} />}
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <Field label="Judul kegiatan" required className="md:col-span-2"><Input value={v.title} onChange={set('title')} /></Field>
        <fieldset className="grid gap-3 rounded-lg border border-navy-200 bg-navy-50/50 p-3 md:col-span-2 md:grid-cols-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-navy-800">Waktu kegiatan</legend>
          <Field label="Tanggal kegiatan" required><Input type="date" value={v.agenda_date} onChange={set('agenda_date')} /></Field>
          <Field label="Jam mulai (WIB)" hint="Kosongkan bila sepanjang hari"><Input type="time" value={v.start_time} onChange={set('start_time')} /></Field>
          <Field label="Jam selesai (WIB)"><Input type="time" value={v.end_time} onChange={set('end_time')} /></Field>
          <p className="text-sm font-medium text-navy-900 md:col-span-3" aria-live="polite">{v.agenda_date ? `${dayName(v.agenda_date)}, ${formatDateID(v.agenda_date)} · ${v.start_time ? `${v.start_time}${v.end_time ? `–${v.end_time}` : ''} WIB${duration(v.start_time, v.end_time)}` : 'sepanjang hari'}` : 'Isi tanggal kegiatan; hari terisi otomatis.'}</p>
        </fieldset>
        <Field label="Nomor surat"><Input value={v.letter_number} onChange={set('letter_number')} /></Field>
        <Field label="Tanggal surat" hint="Tanggal pada surat, bukan tanggal kegiatan"><Input type="date" value={v.letter_date ?? ''} onChange={(e) => setV({ ...v, letter_date: e.target.value || null })} /></Field>
        <Field label="Lokasi"><Input value={v.location} onChange={set('location')} /></Field>
        <Field label="Tautan Zoom/Teams/Google Meet"><Input value={v.meeting_url} onChange={set('meeting_url')} placeholder="https://" /></Field>
        <Field label="Penyelenggara"><Input value={v.organizer} onChange={set('organizer')} /></Field>
        <Field label="Penanggung jawab utama">
          <Select value={v.pic_user_id ?? ''} onChange={(e) => setV({ ...v, pic_user_id: e.target.value || null, support_user_ids: v.support_user_ids.filter((x) => x !== e.target.value) })}>
            <option value="">— Belum ditentukan —</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Program terkait">
          <Select value={v.program_id ?? ''} onChange={(e) => setV({ ...v, program_id: e.target.value || null })}>
            <option value="">— Tidak ada —</option>{programs.data?.map((p) => <option key={p.id} value={p.id}>{String(p.code ?? '')} {String(p.name ?? '')}</option>)}
          </Select>
        </Field>
        {clash.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 md:col-span-2" role="status">
          <b>Jadwal bentrok</b> dengan: {clash.map((c) => `${c.title} (${c.start_time}${c.end_time ? `–${c.end_time}` : ''})${c.shared_staff.length ? `, staf sama: ${c.shared_staff.join(', ')}` : ''}`).join('; ')}. Agenda tetap bisa disimpan.
        </div>}
        <Field label="Peserta yang diundang" className="md:col-span-2"><Textarea rows={2} value={v.participants ?? ''} onChange={(e) => setV({ ...v, participants: e.target.value })} /></Field>
        <Field label="Agenda rapat" className="md:col-span-2"><Textarea rows={3} value={v.agenda_text} onChange={set('agenda_text')} /></Field>
        <div className="md:col-span-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Staf pendukung</div>
          <div className="flex flex-wrap gap-3">{people.data?.filter((p) => p.id !== v.pic_user_id).map((p) => (
            <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={v.support_user_ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>))}
            {people.data && people.data.length < 2 && <span className="text-xs text-slate-500">Tambahkan pengguna dan peran PPK di Pengaturan PPK → Peran Pengguna.</span>}
          </div>
        </div>
        <Field label="Catatan" className="md:col-span-2"><Textarea rows={2} value={v.notes} onChange={set('notes')} /></Field>
      </div>
    </DialogContent>
  );
}

/** Hasil pembacaan format AGENDA PPK: nilai asli, label yang tidak ada, dan nilai yang ditolak. */
function ParsedBox({ m, programMatched }: { m: AgendaMessage; programMatched: boolean }) {
  const bad = new Map(m.invalid.map((x) => [x.field, x.reason]));
  return (
    <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950" role="status">
      <div className="font-semibold">Terbaca dari format AGENDA PPK</div>
      <p className="text-xs text-emerald-900">Formulir sudah diisi dari pesan. Periksa setiap kolom; agenda baru tersimpan setelah Anda menekan Simpan.</p>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
        {(Object.keys(AGENDA_MESSAGE_LABEL) as Array<keyof typeof AGENDA_MESSAGE_LABEL>).map((f) => (<Fragment key={f}>
          <dt className="text-emerald-800">{AGENDA_MESSAGE_LABEL[f]}</dt>
          <dd className={cn(!m.raw[f] || bad.has(f) ? 'text-amber-800' : '')}>
            {m.raw[f] ? m.raw[f] : <i>tidak ada di pesan, isi manual</i>}
            {bad.has(f) && <> · <b>{bad.get(f)}</b> Kolom dikosongkan.</>}
            {f === 'program' && m.raw.program && !programMatched && !bad.has(f) && <> · <b>Tidak cocok dengan program PPK, pilih sendiri.</b></>}
          </dd>
        </Fragment>))}
      </dl>
    </div>
  );
}

export const agendaToInput = (a: Agenda): AgendaInput => ({
  title: a.title, letter_number: a.letter_number, source_document_id: a.source_document_id, agenda_date: a.agenda_date, start_time: a.start_time, end_time: a.end_time,
  location: a.location, meeting_url: a.meeting_url, organizer: a.organizer, agenda_text: a.agenda_text, notes: a.notes, pic_user_id: a.pic?.id ?? null, support_user_ids: a.support.map((s) => s.id),
  letter_date: a.letter_date, program_id: a.program_id, participants: a.participants
});

export const EMPTY_AGENDA: AgendaInput = { title: '', letter_number: '', source_document_id: null, agenda_date: '', start_time: '', end_time: '', location: '',
  meeting_url: '', organizer: '', agenda_text: '', notes: '', pic_user_id: null, support_user_ids: [], letter_date: null, program_id: null, participants: '' };
