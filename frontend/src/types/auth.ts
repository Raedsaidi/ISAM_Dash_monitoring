export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export interface AuthUser {
  id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
}