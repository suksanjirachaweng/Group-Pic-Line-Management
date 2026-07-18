import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UniversitySubNav } from "./UniversitySubNav";

export default async function UniversityLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { name: true },
  });
  if (!university) notFound();

  return (
    <UniversitySubNav universityId={universityId} universityName={university.name}>
      {children}
    </UniversitySubNav>
  );
}
