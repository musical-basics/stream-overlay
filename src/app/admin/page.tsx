import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import AdminPanel from "@/components/AdminPanel";

// Auth is enforced by middleware too; this is a belt-and-suspenders check that
// also gives us the user id/email to hand to the client panel.
export default async function AdminPage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");

  return <AdminPanel userId={user.id} userEmail={user.email ?? ""} />;
}
