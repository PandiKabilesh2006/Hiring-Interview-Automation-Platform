import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  const role = (session.user as { role: string }).role;
  if (role === "candidate") {
    redirect("/candidate");
  }

  return <>{children}</>;
}
