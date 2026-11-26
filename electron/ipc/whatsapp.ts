import { app, net, safeStorage, shell } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { toExportInput } from './files';
import { buildExportName } from '@shared/filename';
import { normalizeWaPhone, waLink } from '@shared/whatsapp';
import { renderPdf } from '../main/pdf';
import { getDb } from '../main/database';
import { currentActor, peekActor } from '../main/numbering/session';
import { requireAdmin } from '../main/numbering/users';
import { audit } from '../main/numbering/audit';
import { deleteSetting, getRawSetting, setSettings } from '../main/repo';
import { alreadyDelivered, deliveryHistory, listRecipients, logDelivery, saveRecipients } from '../main/invitations';
import { cloudSendDocument, type CloudConfig } from '../main/whatsappCloud';

/** PDF siap-lampir dibuat di folder aplikasi sendiri, jadi pengguna tidak perlu mengunggah atau memilih lokasi. */
const outDir = () => path.join(app.getPath('userData'), 'kirim-whatsapp');
const inOutDir = (p: string) => path.dirname(path.resolve(p)) === path.resolve(outDir()) && p.endsWith('.pdf') && fs.existsSync(p);

// shortcut: salinan PDF untuk WhatsApp dihapus setelah 30 hari (dokumen aslinya tetap di arsip); jadikan pengaturan bila ada permintaan.
function prune() {
  const limit = Date.now() - 30 * 24 * 3600_000;
  for (const n of fs.readdirSync(outDir())) {
    const f = path.join(outDir(), n);
    if (n.endsWith('.pdf') && fs.statSync(f).mtimeMs < limit) fs.rmSync(f, { force: true });
  }
}

// Konfigurasi Cloud API: kunci privat (bukan DEFAULT_SETTINGS, tidak ikut settings:get); token dienkripsi safeStorage.
const CLOUD = 'wa_cloud_config'; const TOKEN = 'wa_cloud_token_enc';
const cloudConf = () => { const r = getRawSetting(getDb(), CLOUD); return r ? (JSON.parse(r) as { enabled: boolean; phone_number_id: string; api_version: string }) : null; };
function cloudReady(): CloudConfig {
  const c = cloudConf(); const enc = getRawSetting(getDb(), TOKEN);
  if (!c?.enabled || !c.phone_number_id || !enc) throw new Error('WhatsApp Business API belum diaktifkan administrator.');
  return { phone_number_id: c.phone_number_id, api_version: c.api_version, token: safeStorage.decryptString(Buffer.from(enc, 'base64')) };
}

const phoneOf = (raw: string) => {
  const p = normalizeWaPhone(raw);
  if (!p) throw new Error(`Nomor WhatsApp "${raw}" tidak valid. Contoh: 0812-3456-7890 atau +62 812 3456 7890.`);
  return p;
};

export function registerWhatsAppHandlers() {
  const db = () => getDb();

  handle('wa:preparePdf', S.exportDoc, async ({ doc }) => {
    fs.mkdirSync(outDir(), { recursive: true });
    prune();
    const buf = await renderPdf(toExportInput(doc));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const file = path.join(outDir(), buildExportName({ code: doc.category_code, title: doc.title, date: doc.doc_date, ext: 'pdf' }).replace(/\.pdf$/, `-${sha256.slice(0, 8)}.pdf`));
    fs.writeFileSync(file, buf);
    return { path: file, name: path.basename(file), size: buf.length, sha256 };
  });

  handle('wa:openPdf', z.object({ path: z.string().max(1000) }), async ({ path: p }) => {
    if (!inOutDir(p)) throw new Error('Berkas PDF tidak ditemukan. Siapkan ulang PDF.');
    const err = await shell.openPath(p);
    if (err) throw new Error(`PDF tidak dapat dibuka: ${err}`);
    return true;
  });

  handle('wa:recipients', z.object({ document_id: S.id }), ({ document_id }) => ({ recipients: listRecipients(db(), document_id), history: deliveryHistory(db(), document_id) }));
  handle('wa:saveRecipients', z.object({ document_id: S.id, rows: z.array(z.object({ name: z.string().max(200), organization: z.string().max(200), phone: z.string().max(40) })).max(200) }),
    ({ document_id, rows }) => saveRecipients(db(), peekActor(db()), document_id, rows));

  // Tautan dibangun di sini dari nomor tervalidasi; renderer tidak pernah memberi URL. Yang dicatat hanya "WhatsApp dibuka".
  handle('wa:open', z.object({
    phone: z.string().max(40), text: z.string().min(1).max(4000), target: z.enum(['desktop', 'web']),
    recipient: z.string().max(200), document_id: S.id, pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable()
  }), async (i) => {
    const phone = phoneOf(i.phone);
    await shell.openExternal(waLink(phone, i.text, i.target));
    return logDelivery(db(), peekActor(db()), { document_id: i.document_id, recipient_name: i.recipient, phone, method: i.target === 'desktop' ? 'wa_desktop' : 'wa_web',
      status: 'whatsapp_opened', pdf_sha256: i.pdf_sha256, provider_message_id: null, error: null });
  });
  handle('wa:delivered', z.object({ document_id: S.id, phone: z.string().max(40) }), ({ document_id, phone }) => alreadyDelivered(db(), document_id, phoneOf(phone)));

  handle('wa:cloudStatus', S.empty, () => {
    const c = cloudConf();
    return { enabled: !!c?.enabled, phone_number_id: c?.phone_number_id ?? '', api_version: c?.api_version ?? 'v21.0', token_set: !!getRawSetting(db(), TOKEN) };
  });
  // Hanya administrator. Token tidak pernah dikembalikan ke renderer atau ditulis ke log.
  handle('wa:cloudConfigure', z.object({ enabled: z.boolean(), phone_number_id: z.string().regex(/^\d{0,30}$/, 'Phone Number ID berupa angka.'),
    api_version: z.string().regex(/^v\d{1,3}\.\d$/, 'Versi API mis. v21.0'), token: z.string().max(1000) }), ({ enabled, phone_number_id, api_version, token }) => {
    const a = currentActor(db()); requireAdmin(a);
    if (token.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia; token tidak disimpan.');
      setSettings(db(), { [TOKEN]: safeStorage.encryptString(token.trim()).toString('base64') });
    }
    if (enabled && (!phone_number_id || !getRawSetting(db(), TOKEN))) throw new Error('Isi Phone Number ID dan access token sebelum mengaktifkan.');
    setSettings(db(), { [CLOUD]: JSON.stringify({ enabled, phone_number_id, api_version }) });
    audit(db(), a, 'wa.cloud_config', 'settings', null, { enabled, phone_number_id, api_version, token_changed: !!token.trim() });
    return true;
  });
  handle('wa:cloudForget', S.empty, () => { const a = currentActor(db()); requireAdmin(a); deleteSetting(db(), TOKEN); setSettings(db(), { [CLOUD]: JSON.stringify({ ...(cloudConf() ?? { phone_number_id: '', api_version: 'v21.0' }), enabled: false }) }); audit(db(), a, 'wa.cloud_forget', 'settings', null, {}); return true; });

  // Kirim lewat API: sukses = "submitted" (diterima API). Gagal dicatat; tidak ada kirim ulang otomatis.
  handle('wa:cloudSend', z.object({ document_id: S.id, phone: z.string().max(40), recipient: z.string().max(200), caption: z.string().max(1024), pdf_path: z.string().max(1000) }), async (i) => {
    const c = cloudReady();
    const phone = phoneOf(i.phone);
    if (!inOutDir(i.pdf_path)) throw new Error('Berkas PDF tidak ditemukan. Siapkan ulang PDF.');
    const pdf = fs.readFileSync(i.pdf_path);
    const pdf_sha256 = createHash('sha256').update(pdf).digest('hex');
    const actor = peekActor(db());
    const base = { document_id: i.document_id, recipient_name: i.recipient, phone, method: 'cloud_api' as const, pdf_sha256 };
    try {
      const r = await cloudSendDocument(c, (u, init) => net.fetch(u, init as RequestInit), { to: phone, pdf, filename: path.basename(i.pdf_path), caption: i.caption });
      return logDelivery(db(), actor, { ...base, status: 'submitted', provider_message_id: r.message_id, error: null });
    } catch (e) {
      logDelivery(db(), actor, { ...base, status: 'failed', provider_message_id: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
      throw e;
    }
  });
}
