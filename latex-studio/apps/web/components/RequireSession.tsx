'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loadSession } from '@/lib/session';

/** Client-side guard: app pages render only with a session; otherwise → /login.
 *  (Construction scaffold — see lib/session.ts.) */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (loadSession()) setOk(true);
    else router.replace(`/login?next=${encodeURIComponent(pathname ?? '/studio')}`);
  }, [router, pathname]);

  return ok ? <>{children}</> : null;
}
