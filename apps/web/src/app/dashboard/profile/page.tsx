import { redirect } from "next/navigation";

export default function ProfileRedirectPage() {
  redirect("/dashboard/settings");
}
