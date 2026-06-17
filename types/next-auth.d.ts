import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      email: string | null;
      name: string | null;
      roles: string[];
      employee_id: string | null;
      division_id?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles: string[];
    employee_id: string | null;
    division_id?: string | null;
    /** Set for optional UAT credential logins only; Azure AD sessions omit this. */
    authSource?: "uat";
  }
}
