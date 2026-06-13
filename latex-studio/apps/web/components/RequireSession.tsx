'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from '@/lib/authClient';
import { saveSession, signOut as clearProfile } from '@/lib/session';

/**
 * Client-side guard: app pages render only with a valid Better Auth session
 * (an HttpOnly cookie validated server-side). No session → redirect to /login.
 * The real enforcement is on the api — every route runs through the ownership
 * guard — so this only keeps logged-out users out of the app shell.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (session?.user) {
      saveSession({ email: session.user.email, name: session.user.name });
    } else {
      clearProfile();
      router.replace(`/login?next=${encodeURIComponent(pathname ?? '/studio')}`);
    }
  }, [isPending, session, router, pathname]);

  return session?.user ? <>{children}</> : null;
}
