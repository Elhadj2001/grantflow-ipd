import 'next-auth';
import 'next-auth/jwt';
import type { GrantflowRole } from '@/lib/auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    roles: GrantflowRole[];
    fullName: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    roles?: GrantflowRole[];
    fullName?: string;
  }
}
