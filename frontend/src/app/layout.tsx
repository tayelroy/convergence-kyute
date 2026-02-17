import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kyute | Funding Rate Arbitrage Vault",
  description:
    "Institutional-grade yield strategy platform capturing structural inefficiencies in global funding rate markets via Chainlink CRE and Pendle Boros.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${robotoMono.variable} font-sans antialiased bg-[#0a0a0f] text-neutral-100 h-screen w-screen overflow-hidden`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
