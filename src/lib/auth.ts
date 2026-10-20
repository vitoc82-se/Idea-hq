import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { normalizeEmail } from "./support/sanitize";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password required");
        }

        // Same standard form as sign-up. Case-insensitive, so older accounts stored with capitals
        // still work. If a few accounts share the address (older lookalikes), the password decides.
        const email = normalizeEmail(credentials.email);
        if (!email) throw new Error("Invalid credentials");
        const candidates = await db.user.findMany({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, email: true, name: true, image: true, password: true },
          take: 5,
        });
        for (const user of candidates) {
          if (user.password && (await bcrypt.compare(credentials.password, user.password))) {
            return { id: user.id, email: user.email, name: user.name, image: user.image };
          }
        }
        throw new Error("Invalid credentials");
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
