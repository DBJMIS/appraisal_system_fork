import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConditionalShell } from "@/components/layout/conditional-shell";
import { ClientSessionWrapper } from "@/components/providers/client-session-wrapper";
import "@/app/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Employee Performance Appraisal Portal",
  description: "Internal portal for performance appraisals, workplans, and development.",
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ClientSessionWrapper>
          <TooltipProvider>
            <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--surface)]" />}>
              <ConditionalShell>{children}</ConditionalShell>
            </Suspense>
          </TooltipProvider>
        </ClientSessionWrapper>
      </body>
    </html>
  );
}
