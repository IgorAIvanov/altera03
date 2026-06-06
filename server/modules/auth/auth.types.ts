export interface AuthUserRow {
  id: string;
  login: string;
  full_name: string;
  is_active?: boolean;
  password_hash?: string;
}

export interface AuthUserDto {
  id: string;
  login: string;
  fullName: string;
}

export interface AuthMethodDescriptor {
  key: string;
  label: string;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  auth_method: string;
  expires_at: string;
}

export interface AuthSessionInfo {
  id: string;
  authMethod: string;
  token: string;
  expiresAt: string;
}

export interface AuthLoginRequest {
  method?: string;
  login?: string;
  password?: string;
  payload?: Record<string, unknown>;
}

export interface AuthResolvedAttempt {
  method: string;
  payload: Record<string, unknown>;
}

export interface AuthMethod {
  readonly key: string;
  readonly label: string;
  authenticate(payload: Record<string, unknown>): Promise<AuthUserDto | null>;
}

export interface AuthLoginResult {
  user: AuthUserDto;
  method: string;
  session: AuthSessionInfo;
}

export function toAuthUserDto(user: AuthUserRow): AuthUserDto {
  return {
    id: user.id,
    login: user.login,
    fullName: user.full_name,
  };
}