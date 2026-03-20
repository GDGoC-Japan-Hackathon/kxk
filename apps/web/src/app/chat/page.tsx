import { SiteHeader } from "@/components/SiteHeader";
import { MacroChatWorkspace } from "@/components/chat/MacroChatWorkspace";

export default function ChatPage() {
  return (
    <main className="screen-shell chat-page-shell">
      <SiteHeader />
      <MacroChatWorkspace />
    </main>
  );
}
