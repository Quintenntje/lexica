import { MessageSquare } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/placeholder-page';

export function ChatPage() {
  return (
    <PlaceholderPage
      icon={MessageSquare}
      title="Chat"
      description="Ask questions about your legal documents and get cited answers. Coming soon."
    />
  );
}
