import { redirect } from "next/navigation";
import { getCurrentUser, isPlaceholderUser } from "@/lib/auth";

export default async function HrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || isPlaceholderUser(user) || !user.roles?.some((r) => r === "hr" || r === "admin")) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
