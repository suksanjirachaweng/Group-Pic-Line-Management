import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const admin = await prisma.adminUser.findUnique({
          where: { email: credentials.email.toLowerCase() },
          include: { universities: true },
        });
        if (!admin || !admin.isActive) return null;

        const isValid = await compare(credentials.password, admin.passwordHash);
        if (!isValid) return null;

        return {
          id: admin.id,
          email: admin.email,
          role: admin.role,
          universityIds: admin.universities.map((u) => u.universityId),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.universityIds = user.universityIds;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.universityIds = token.universityIds;
      return session;
    },
  },
};

/** True if the given session role/universityIds can access the given university. */
export function canAccessUniversity(
  user: { role: AdminRole; universityIds: string[] },
  universityId: string,
): boolean {
  return user.role === AdminRole.SUPERADMIN || user.universityIds.includes(universityId);
}
