import { registerDataHandlers } from './data';
import { registerFileHandlers } from './files';
import { registerImporterHandlers } from './importer';
import { registerNumberingHandlers } from './numbering';
import { registerPpkHandlers } from './ppk';
import { registerSettingsHandlers } from './settings';
import { registerWhatsAppHandlers } from './whatsapp';
import { registerWebHandlers } from './web';

export function registerIpc() {
  registerDataHandlers();
  registerFileHandlers();
  registerSettingsHandlers();
  registerImporterHandlers();
  registerNumberingHandlers();
  registerPpkHandlers();
  registerWhatsAppHandlers();
  registerWebHandlers(); // terakhir: memakai semua handler yang sudah terdaftar
}
