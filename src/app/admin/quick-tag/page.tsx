import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";
import { listPhotoEvents, getDefaultPhotoEventId, type PhotoEventListItem } from "@/lib/actions/photoEvents";
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

  // The desktop group-photos upload flow lets the admin pick which event a photo goes to via
  // EventFilterDropdown — this mobile wizard silently used getDefaultPhotoEventId with no way to
  // override it, so uploading into an older (non-default) event from a phone wasn't possible.
  // Fetches both the full event list (for the picker) and the same default the rest of the app
  // uses, so the pre-selected value matches what desktop uploads would have defaulted to too.
  const eventsByUniversity: Record<string, PhotoEventListItem[]> = {};
  const defaultEventIdByUniversity: Record<string, string> = {};
  await Promise.all(
    universities.map(async (u) => {
      const [events, defaultId] = await Promise.all([listPhotoEvents(u.id), getDefaultPhotoEventId(u.id)]);
      eventsByUniversity[u.id] = events;
      defaultEventIdByUniversity[u.id] = defaultId;
    }),
  );

  return (
    <QuickTagWizard
      universities={universities}
      eventsByUniversity={eventsByUniversity}
      defaultEventIdByUniversity={defaultEventIdByUniversity}
    />
  );
}
