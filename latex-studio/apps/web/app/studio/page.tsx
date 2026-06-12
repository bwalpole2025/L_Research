import { EditorApp } from '@/components/EditorApp';
import { RequireSession } from '@/components/RequireSession';

export default function StudioPage() {
  return (
    <RequireSession>
      <EditorApp />
    </RequireSession>
  );
}
