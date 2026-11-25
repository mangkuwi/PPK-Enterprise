import { registerDataHandlers } from './data';
import { registerFileHandlers } from './files';
import { registerImporterHandlers } from './importer';
import { registerNumberingHandlers } from './numbering';
import { registerSettingsHandlers } from './settings';

export function registerIpc() {
  registerDataHandlers();
  registerFileHandlers();
  registerSettingsHandlers();
  registerImporterHandlers();
  registerNumberingHandlers();
}
