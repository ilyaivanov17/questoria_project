export interface AuthenticatedUser {
  userId: string;
  profileId: string;
  sessionId: string;
  email: string;
  nickname: string | null;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}
