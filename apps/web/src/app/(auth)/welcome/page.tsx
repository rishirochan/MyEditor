import { redirect } from "next/navigation";
import { findLocalUser } from "@/lib/db/queries/users";
import { isTexInstalled } from "@/lib/compiler/tex";
import { WelcomeSetup } from "./WelcomeSetup";

export const dynamic = "force-dynamic";

// First launch: ask for a name and set up LaTeX. Every later launch passes
// straight through to the dashboard.
export default async function WelcomePage() {
  const [user, texInstalled] = await Promise.all([findLocalUser(), isTexInstalled()]);
  if (user && texInstalled) redirect("/dashboard");

  return <WelcomeSetup needsName={!user} texInstalled={texInstalled} />;
}
