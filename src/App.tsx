import { Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import DashboardPage from './pages/DashboardPage';
import TemplatesPage from './pages/TemplatesPage';
import TemplateEditorPage from './pages/TemplateEditorPage';
import GeneratorPage from './pages/GeneratorPage';
import ArchivePage from './pages/ArchivePage';
import DocumentPage from './pages/DocumentPage';
import SettingsPage from './pages/SettingsPage';
import BankNomorPage from './pages/BankNomorPage';
import ImporterUploadPage from './pages/ImporterUploadPage';
import ImporterReviewPage from './pages/ImporterReviewPage';
import ImportListPage from './pages/ImportListPage';
import ImporterLatestPage from './pages/ImporterLatestPage';
import NumberingDashboardPage from './pages/NumberingDashboardPage';
import NumberingSettingsPage from './pages/NumberingSettingsPage';
import RegisterPage from './pages/RegisterPage';
import RegisterImportPage from './pages/RegisterImportPage';
import VendorsPage from './pages/ppk/VendorsPage';
import PpkSettingsPage from './pages/ppk/PpkSettingsPage';
import BudgetPage from './pages/ppk/BudgetPage';
import ContractsPage from './pages/ppk/ContractsPage';
import BillsPage from './pages/ppk/BillsPage';
import ImportPage from './pages/ppk/ImportPage';

export default function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/new" element={<TemplateEditorPage />} />
          <Route path="/templates/:id" element={<TemplateEditorPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/documents/:id" element={<DocumentPage />} />
          <Route path="/importer" element={<ImporterUploadPage />} />
          <Route path="/importer/analyze" element={<ImporterUploadPage pendingOnly />} />
          <Route path="/importer/review" element={<ImporterLatestPage />} />
          <Route path="/importer/review/:id" element={<ImporterReviewPage />} />
          <Route path="/importer/preview" element={<ImporterLatestPage tab="compare" />} />
          <Route path="/importer/templates" element={<ImportListPage mode="templates" />} />
          <Route path="/importer/history" element={<ImportListPage mode="history" />} />
          <Route path="/bank-nomor" element={<BankNomorPage />} />
          <Route path="/penomoran" element={<NumberingDashboardPage />} />
          <Route path="/penomoran/pengaturan" element={<NumberingSettingsPage />} />
          <Route path="/penomoran/impor" element={<RegisterImportPage />} />
          <Route path="/register/:slug" element={<RegisterPage />} />
          <Route path="/ppk/anggaran" element={<BudgetPage />} />
          <Route path="/ppk/kontrak" element={<ContractsPage />} />
          <Route path="/ppk/tagihan" element={<BillsPage />} />
          <Route path="/ppk/impor" element={<ImportPage />} />
          <Route path="/ppk/penyedia" element={<VendorsPage />} />
          <Route path="/ppk/pengaturan" element={<PpkSettingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
