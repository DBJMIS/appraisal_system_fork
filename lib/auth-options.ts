import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { createClient } from "@supabase/supabase-js";
import { createDataverseApiClient } from "@/lib/dynamics-sync";
import { createUatCredentialsProvider } from "@/lib/auth-uat-provider";
import {
  UAT_CREDENTIALS_PROVIDER_ID,
  isUatCredentialsEnabled,
  type UatAuthorizedUser,
} from "@/lib/uat-credentials";

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const azureAdProvider = AzureADProvider({
  clientId: process.env.AZURE_AD_CLIENT_ID!,
  clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
  tenantId: process.env.AZURE_AD_TENANT_ID!,
  authorization: {
    params: {
      scope: "openid profile email User.Read",
    },
  },
});

export const authOptions: NextAuthOptions = {
  providers: [
    azureAdProvider,
    ...(isUatCredentialsEnabled() ? [createUatCredentialsProvider()] : []),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // Optional UAT path — skipped entirely when ENABLE_UAT_CREDENTIALS is not set.
      if (account?.provider === UAT_CREDENTIALS_PROVIDER_ID && user) {
        const u = user as UatAuthorizedUser;
        token.email = u.email;
        token.name = u.name;
        token.employee_id = u.employee_id;
        token.division_id = u.division_id ?? null;
        token.roles = u.roles;
        token.authSource = "uat";
        return token;
      }

      if (token.authSource === "uat") {
        return token;
      }

      // Azure AD SSO (unchanged)
      if (account && profile) {
        const p = profile as { email?: string; name?: string };
        token.email = p?.email ?? token.email;
        token.name = p?.name ?? token.name;
      }

      const supabase = getSupabaseService();
      if (token.email) {
        // Identity from Dynamics HRMIS (systemusers) only.
        try {
          const client = await createDataverseApiClient();
          const email = String(token.email).trim().replace(/'/g, "''");
          const baseFilter = `internalemailaddress eq '${email}' and isdisabled eq false`;

          let hrmisUser: { systemuserid?: string | null; _xrm1_division_value?: string | null } | null = null;
          try {
            const withDivision = await client.get<{
              value?: Array<{ systemuserid?: string | null; _xrm1_division_value?: string | null }>;
            }>(
              `/systemusers?$select=systemuserid,_xrm1_division_value&$filter=${encodeURIComponent(baseFilter)}&$top=1`
            );
            hrmisUser = withDivision.data?.value?.[0] ?? null;
          } catch {
            // Fallback if custom division field is not present in this Dataverse schema.
            const basic = await client.get<{ value?: Array<{ systemuserid?: string | null }> }>(
              `/systemusers?$select=systemuserid&$filter=${encodeURIComponent(baseFilter)}&$top=1`
            );
            const u = basic.data?.value?.[0];
            hrmisUser = u ? { systemuserid: u.systemuserid ?? null, _xrm1_division_value: null } : null;
          }

          token.employee_id = hrmisUser?.systemuserid ?? null;
          token.division_id = hrmisUser?._xrm1_division_value ?? null;
        } catch (e) {
          console.warn("[auth] HRMIS lookup failed:", e);
          token.employee_id = null;
          token.division_id = null;
        }
      } else {
        token.employee_id = null;
        token.division_id = null;
      }

      if (supabase && token.email) {
        // Roles from app_users only.
        const { data: appUser } = await supabase
          .from("app_users")
          .select("roles")
          .ilike("email", String(token.email))
          .maybeSingle();

        token.roles = Array.isArray(appUser?.roles) ? appUser.roles.map((r) => String(r)) : [];
      } else {
        token.roles = [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email ?? null;
        session.user.name = (token.name as string) ?? session.user.name ?? null;
        session.user.roles = ((token.roles as string[] | undefined) ?? []);
        session.user.employee_id = (token.employee_id as string | null | undefined) ?? null;
        session.user.division_id = (token.division_id as string | null | undefined) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
