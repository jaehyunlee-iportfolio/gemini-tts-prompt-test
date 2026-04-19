import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ALLOWED_GOOGLE_EMAIL_DOMAIN } from "@/lib/registry-access";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase();
      if (!email.endsWith(`@${ALLOWED_GOOGLE_EMAIL_DOMAIN}`)) {
        return false;
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
