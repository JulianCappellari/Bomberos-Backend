export type UserListItem = {
  id: string;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
  isPendingApproval: boolean;
  createdAt: Date;
  profile: {
    fullName: string;
    dni: string;
    rank: string;
    badge: string;
    phone: string | null;
    altPhone: string | null;
    address: string | null;
    bloodType: string | null;
    joinDate: Date | null;
  } | null;
  emergencyContact: {
    fullName: string;
    phone: string;
    relationship: string | null;
  } | null;
};