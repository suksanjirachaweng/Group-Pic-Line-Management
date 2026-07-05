import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const university = await prisma.university.findUnique({
    where: { slug },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });

  if (!university || !university.isActive) {
    return NextResponse.json({ error: "University not found" }, { status: 404 });
  }

  return NextResponse.json({
    university: {
      name: university.name,
      slug: university.slug,
      headerImageUrl: university.headerImageUrl,
      themeColor: university.themeColor,
    },
    fields: university.formFields.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      imageUrl: f.imageUrl,
      fieldType: f.fieldType,
      options: f.options,
      isRequired: f.isRequired,
    })),
  });
}
