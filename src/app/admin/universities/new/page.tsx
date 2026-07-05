import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";
import { createUniversity } from "@/lib/actions/universities";

export default async function NewUniversityPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">New university</h1>

      <form action={createUniversity} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Slug</label>
          <input
            name="slug"
            required
            placeholder="e.g. ku, tu, cmu"
            pattern="[a-z0-9-]+"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Used in the public registration link: /register/&lt;slug&gt;
          </p>
        </div>

        <button
          type="submit"
          className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm font-medium text-white"
        >
          Create
        </button>
      </form>
    </div>
  );
}
