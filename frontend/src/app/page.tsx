"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { LampContainer } from "@/components/ui/lamp";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header1 } from "@/components/ui/header";
import { LiveArbitragePulse } from "@/components/ui/live-arbitrage-pulse";
import { VaultHeroCard } from "@/components/ui/vault-hero-card";

export default function LandingPage() {
  return (
    <main className="relative min-h-screen pt-40 bg-[#020617]">
      <Header1 />

      {/* Live Arbitrage Pulse — independently positioned above the lamp */}
      <div className="relative z-50 flex justify-center mb-6">
        <LiveArbitragePulse />
      </div>

      <LampContainer>        <motion.h1
        initial={{ opacity: 0.5, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{
          delay: 0.3,
          duration: 0.8,
          ease: "easeInOut",
        }}
        className="bg-gradient-to-br from-white to-neutral-500 py-4 bg-clip-text text-center text-4xl font-medium tracking-tight text-transparent md:text-7xl"
      >
        Kyute
      </motion.h1>

        <div className="flex flex-col items-center gap-6 mt-4">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="text-center text-sm md:text-base font-mono text-neutral-400 max-w-lg"
          >
            Decentralized Funding Rate Arbitrage Vault
            <br />
            <span className="text-neutral-500">
              Powered by Chainlink CRE & Boros Pendle
            </span>
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.8 }}
          >
            <Link href="/dashboard">
              <Button
                variant="ghost"
                className="rounded-[1.15rem] px-8 py-6 text-lg font-semibold backdrop-blur-md 
                bg-white/95 hover:bg-white/100 dark:bg-black/95 dark:hover:bg-black/100 
                text-black dark:text-[#009a22] transition-all duration-300 
                group-hover:-translate-y-0.5 border border-black/10 dark:border-[#009a22]/30
                hover:shadow-md dark:hover:shadow-[#009a22]/20 group"
              >
                <span className="opacity-90 group-hover:opacity-100 transition-opacity">
                  Enter Dashboard
                </span>
                <span
                  className="ml-3 opacity-70 group-hover:opacity-100 group-hover:translate-x-1.5 
                  transition-all duration-300"
                >
                  <ArrowRight className="h-5 w-5" />
                </span>
              </Button>
            </Link>
          </motion.div>

          {/* Vault Hero Card — below the CTA */}
          <VaultHeroCard />
        </div>
      </LampContainer>
    </main>
  );
}
