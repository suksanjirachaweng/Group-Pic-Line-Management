import { AdminRole } from "@/generated/prisma/enums";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      role: AdminRole;
      universityIds: string[];
    };
  }

  interface User {
    id: string;
    email: string;
    role: AdminRole;
    universityIds: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: AdminRole;
    universityIds: string[];
  }
}
