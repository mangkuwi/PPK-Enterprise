import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { saveFile } from './numbering';
import { getDb } from '../main/database';
import { currentActor, peekActor } from '../main/numbering/session';
import { writeXlsx } from '../main/numbering/xlsx';
import { sqliteStore } from '../main/ppk/store';
import { listPpkUsers, ppkAccess, setPpkRole } from '../main/ppk/access';
import { listMaster, listTaxRates, saveMaster } from '../main/ppk/master';
import { VENDOR_EXPORT_HEADER, createVendor, getVendor, listVendors, setVendorStatus, similarVendors, updateVendor, vendorExportRow } from '../main/ppk/vendors';
import { MASTER_KEYS, type MasterKey } from '@shared/ppk/master';
import { PPK_ROLES } from '@shared/ppk/access';
import { VENDOR_STATUS } from '@shared/ppk/vendors';

const text = (max: number) => z.string().max(max);
const vendorInput = z.object({
  name: text(200), npwp: text(30), nib: text(30), address: text(500), contact_person: text(120), email: text(120), phone: text(40),
  bank_name: text(120), account_number: text(40), account_holder: text(200), service_category_id: S.id.nullable(), notes: text(2000)
});
const masterKey = z.enum(MASTER_KEYS as [MasterKey, ...MasterKey[]]);

/** Semua channel ppk:* memeriksa izin di lapisan domain (requirePpk), bukan hanya menyembunyikan menu. */
export function registerPpkHandlers() {
  const st = () => sqliteStore(getDb());
  const actor = () => currentActor(getDb());

  handle('ppk:access', S.empty, async () => { const a = peekActor(getDb()); return a ? ppkAccess(st(), a) : null; });
  handle('ppk:users', S.empty, () => listPpkUsers(st(), actor()));
  handle('ppk:setRole', z.object({ user_id: S.id, role: z.enum(PPK_ROLES).nullable() }), async ({ user_id, role }) => { await setPpkRole(st(), actor(), user_id, role); return true; });

  handle('ppk:master:list', z.object({ key: masterKey }), ({ key }) => listMaster(st(), actor(), key));
  handle('ppk:master:save', z.object({ key: masterKey, values: z.record(z.union([z.string().max(300), z.number(), z.boolean(), z.null()])) }),
    ({ key, values }) => saveMaster(st(), actor(), key, values as Record<string, unknown> & { id?: string }));
  handle('ppk:taxRates', S.empty, () => listTaxRates(st(), actor()));

  handle('ppk:vendors:list', z.object({ search: text(200).optional(), status: z.enum([...VENDOR_STATUS, 'semua']).optional(), service_category_id: S.id.optional() }),
    (f) => listVendors(st(), actor(), f));
  handle('ppk:vendors:get', z.object({ id: S.id }), ({ id }) => getVendor(st(), actor(), id));
  handle('ppk:vendors:similar', z.object({ name: text(200), npwp: text(30), except_id: S.id.optional() }), ({ name, npwp, except_id }) => similarVendors(st(), actor(), name, npwp, except_id));
  handle('ppk:vendors:create', vendorInput, (i) => createVendor(st(), actor(), i));
  handle('ppk:vendors:update', z.object({ id: S.id, version: z.number().int().min(1), values: vendorInput }), ({ id, version, values }) => updateVendor(st(), actor(), id, version, values));
  handle('ppk:vendors:setStatus', z.object({ id: S.id, status: z.enum(VENDOR_STATUS), reason: text(500) }), ({ id, status, reason }) => setVendorStatus(st(), actor(), id, status, reason));
  handle('ppk:vendors:export', z.object({ status: z.enum([...VENDOR_STATUS, 'semua']).optional() }), async ({ status }) => {
    const rows = await listVendors(st(), actor(), { status: status ?? 'semua' });
    const buf = writeXlsx([{ name: 'Penyedia', header: VENDOR_EXPORT_HEADER, rows: rows.map(vendorExportRow), widths: [36, 20, 18, 40, 22, 26, 16, 18, 20, 28, 20, 12, 30] }]);
    return saveFile(buf, `Database-Penyedia-${new Date().toISOString().slice(0, 10)}.xlsx`, 'xlsx');
  });
}
