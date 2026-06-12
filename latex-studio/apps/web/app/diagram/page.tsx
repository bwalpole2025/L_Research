import { RequireSession } from '@/components/RequireSession';
import { DiagramEditor } from '@/components/diagram/DiagramEditor';

export default function DiagramPage() {
  return (
    <RequireSession>
      <DiagramEditor />
    </RequireSession>
  );
}
