"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { ArrowRight, TrendingUp } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative">
      <BackgroundPaths title="Kyute" />

      {/* Overlay content positioned below the title */}
      <div className="absolute bottom-[18%] left-0 right-0 z-20 flex flex-col items-center gap-6 px-4">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.8 }}
          className="text-center text-sm md:text-base font-mono text-neutral-400 max-w-lg"
        >
          Decentralized Funding Rate Arbitrage Vault
          <br />
          <span className="text-neutral-600">
            Powered by Chainlink CRE × Pendle Boros
          </span>
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.8 }}
        >
          <Link
            href="/dashboard"
            className="group flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 
            px-6 py-3 text-sm font-semibold text-emerald-400 transition-all duration-300 
            hover:bg-emerald-500/20 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10"
          >
            <TrendingUp className="h-4 w-4" />
            Enter Dashboard
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
