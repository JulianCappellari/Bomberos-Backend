export type SafeUser = {
  primaryRole: string;
  guardEligible: boolean;
  specialPermissions: string[];
  accessMode: "PERSONAL" | "GUARD";
  id: string;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
  isPendingApproval: boolean;
  mustChangePassword: boolean;
  profile: {
    fullName: string;
    rank: string;
    badge: string;
  } | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type LoginResponse = {
  user: SafeUser;
  tokens: AuthTokens;
};
