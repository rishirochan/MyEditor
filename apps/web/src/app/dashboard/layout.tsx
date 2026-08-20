"use client";

import { AppHeader } from "@/components/AppHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      <AppHeader className="sticky top-0" />
      {/* Administrate mode: this is the one surface that gets air. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
