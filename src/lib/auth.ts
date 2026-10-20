import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { normalizeEmail } from "./support/sanitize";
import { ipFrom, loginBlocked, TOO_MANY_LOGINS } from "./auth-limits";

// A real bcrypt hash of a throwaway password. Checking against it when the address is unknown (or the
// account has no password) makes a failed sign-in take as long as a real one, so timing does not reveal
// which addresses have accounts.
const DUMMY_HASH = "$2b$12$KP9AahZQ6BkaJK7YcWORcOMHbCEUV8en4SAtyMVelcV/oGKQ4vYQ.";

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
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password required");
        }
        // Brakes first: a flood is refused before any password is hashed.
        const ip = ipFrom(req?.headers as Record<string, string> | undefined);
        const key = (normalizeEmail(credentials.email) ?? String(credentials.email).trim().toLowerCase()).slice(0, 254);
        if (await loginBlocked(ip, key)) throw new Error(TOO_MANY_LOGINS);
        // bcrypt only reads 72 bytes; anything much longer is not a password, and is not worth hashing.
        if (typeof credentials.password !== "string" || credentials.password.length > 200) throw new Error("Invalid credentials");

        // Same standard form as sign-up. Case-insensitive, so older accounts stored with capitals
        // still work. If a few accounts share the address (older lookalikes), the password decides.
        const email = normalizeEmail(credentials.email);
        if (!email) {
          await bcrypt.compare(credentials.password, DUMMY_HASH);
          throw new Error("Invalid credentials");
        }
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
        // Nobody matched. Spend the same time as a real check before saying so.
        if (!candidates.some((u) => u.password)) await bcrypt.compare(credentials.password, DUMMY_HASH);
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
