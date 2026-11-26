import { Route, Routes } from 'react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { ChatPage } from '@/features/chat/chat-page';
import { DocumentsPage } from '@/features/documents/documents-page';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ChatPage />} />
        <Route path="documents" element={<DocumentsPage />} />
      </Route>
    </Routes>
  );
}
