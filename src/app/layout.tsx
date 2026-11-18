import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ToastProvider } from "@/components/ui/overlay";
import { ServiceWorker } from "@/components/ServiceWorker";

const ui = Hanken_Grotesk({ variable: "--font-ui", subsets: ["latin"], display: "swap" });
const instrument = Chakra_Petch({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Projet Traque";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Jeu de traque multijoueur privé entre amis : Chasseurs contre Fugitifs sur une carte virtuelle.",
  manifest: "/manifest.webmanifest",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050608",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${ui.variable} ${instrument.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
