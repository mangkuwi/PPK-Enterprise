import { registerDataHandlers } from './data';
import { registerFileHandlers } from './files';
import { registerImporterHandlers } from './importer';
import { registerNumberingHandlers } from './numbering';
import { registerPpkHandlers } from './ppk';
import { registerSettingsHandlers } from './settings';
import { registerWhatsAppHandlers } from './whatsapp';

export function registerIpc() {
  registerDataHandlers();
  registerFileHandlers();
  registerSettingsHandlers();
  registerImporterHandlers();
  registerNumberingHandlers();
  registerPpkHandlers();
  registerWhatsAppHandlers();
}
