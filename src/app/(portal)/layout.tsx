import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/candidate-auth");
  }

  const role = (session.user as { role: string }).role;
  if (role !== "candidate") {
    redirect("/");
  }

  return <>{children}</>;
}
