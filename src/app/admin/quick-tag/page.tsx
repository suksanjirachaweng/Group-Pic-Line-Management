import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";
import { QuickTagWizard } from "./QuickTagWizard";

export default async function QuickTagPage() {
  const session = await getServerSession(authOptions);
  const user = session!.user;
  const isSuperadmin = user.role === AdminRole.SUPERADMIN;

  // Same accessible-universities query as /admin/universities — superadmin sees everything,
  // a university admin only sees what they're scoped to.
  const universities = await prisma.university.findMany({
    where: isSuperadmin ? {} : { id: { in: user.universityIds } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return <QuickTagWizard universities={universities} />;
}
