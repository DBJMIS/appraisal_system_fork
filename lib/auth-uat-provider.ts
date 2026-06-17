import CredentialsProvider from "next-auth/providers/credentials";
import {
  UAT_CREDENTIALS_PROVIDER_ID,
  isUatCredentialsEnabled,
  verifyUatLogin,
} from "@/lib/uat-credentials";

/** Optional UAT provider — only registered when ENABLE_UAT_CREDENTIALS=true. */
export function createUatCredentialsProvider() {  return CredentialsProvider({
    id: UAT_CREDENTIALS_PROVIDER_ID,
    name: "UAT credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!isUatCredentialsEnabled()) return null;

      const email = credentials?.email;
      const password = credentials?.password;
      if (!email || !password) return null;

      const user = await verifyUatLogin(String(email), String(password));
      if (!user) return null;

      return user;
    },
  });
}
