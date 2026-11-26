import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { dayName, type Agenda, type AgendaInput } from '@shared/ppk/agenda';

/** Formulir agenda (baru dari surat undangan, atau ubah). Penanggung jawab dipilih dari pengguna yang punya peran PPK. */
export function AgendaForm({ initial, existing, onSaved }: { initial: AgendaInput; existing?: Agenda; onSaved: (a: Agenda) => void }) {
  const { toast } = useFeedback();
  const people = useAsync(() => api.ppk.agendas.people(), []);
  const [v, setV] = useState<AgendaInput>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AgendaInput>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const toggle = (id: string) => setV({ ...v, support_user_ids: v.support_user_ids.includes(id) ? v.support_user_ids.filter((x) => x !== id) : [...v.support_user_ids, id] });
  const save = async () => {
    setBusy(true);
    try { onSaved(existing ? await api.ppk.agendas.update(existing.id, existing.version, v) : await api.ppk.agendas.create(v)); toast(existing ? 'Agenda diperbarui.' : 'Agenda dibuat dan tampil di Agenda PPK.', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <DialogContent wide title={existing ? 'Ubah agenda' : 'Buat agenda'} description="Diisi dari surat undangan; periksa sebelum menyimpan. Agenda tidak bergantung pada pengiriman WhatsApp."
      footer={<Button disabled={busy} onClick={save}>{existing ? 'Simpan perubahan' : 'Simpan agenda'}</Button>}>
      {people.error && <p className="mb-2 text-sm text-red-700" role="alert">{people.error}</p>}
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <Field label="Judul kegiatan" required className="md:col-span-2"><Input value={v.title} onChange={set('title')} /></Field>
        <Field label="Nomor surat"><Input value={v.letter_number} onChange={set('letter_number')} /></Field>
        <Field label="Tanggal" required hint={v.agenda_date ? `Hari: ${dayName(v.agenda_date)}` : 'Hari terisi otomatis dari tanggal'}><Input type="date" value={v.agenda_date} onChange={set('agenda_date')} /></Field>
        <Field label="Jam mulai"><Input type="time" value={v.start_time} onChange={set('start_time')} /></Field>
        <Field label="Jam selesai"><Input type="time" value={v.end_time} onChange={set('end_time')} /></Field>
        <Field label="Lokasi"><Input value={v.location} onChange={set('location')} /></Field>
        <Field label="Tautan Zoom/Teams/Google Meet"><Input value={v.meeting_url} onChange={set('meeting_url')} placeholder="https://" /></Field>
        <Field label="Penyelenggara"><Input value={v.organizer} onChange={set('organizer')} /></Field>
        <Field label="Penanggung jawab utama">
          <Select value={v.pic_user_id ?? ''} onChange={(e) => setV({ ...v, pic_user_id: e.target.value || null, support_user_ids: v.support_user_ids.filter((x) => x !== e.target.value) })}>
            <option value="">— Belum ditentukan —</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
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

export const agendaToInput = (a: Agenda): AgendaInput => ({
  title: a.title, letter_number: a.letter_number, source_document_id: a.source_document_id, agenda_date: a.agenda_date, start_time: a.start_time, end_time: a.end_time,
  location: a.location, meeting_url: a.meeting_url, organizer: a.organizer, agenda_text: a.agenda_text, notes: a.notes, pic_user_id: a.pic?.id ?? null, support_user_ids: a.support.map((s) => s.id)
});
