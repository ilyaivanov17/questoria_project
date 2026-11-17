export interface AuthenticatedUser {
  userId: string;
  profileId: string;
  sessionId: string;
  email: string;
  nickname: string | null;
  roleKeys: string[];
  mfaEnabled: boolean;
  sessionMfaVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}
