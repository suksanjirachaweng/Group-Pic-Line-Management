import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";
import { AdminChrome } from "./AdminChrome";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const isSuperadmin = session.user.role === AdminRole.SUPERADMIN;

  return (
    <AdminChrome email={session.user.email} role={session.user.role} isSuperadmin={isSuperadmin}>
      {children}
    </AdminChrome>
  );
}
