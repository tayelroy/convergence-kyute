"use client";

import { motion } from "framer-motion";
import { Shield, TrendingUp } from "lucide-react";

export function VaultHeroCard() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0, duration: 0.9, ease: "easeOut" }}
            className="relative w-full max-w-sm mx-auto mt-10"
        >
            {/* Outer glow */}
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-b from-[#009a22]/20 via-transparent to-transparent blur-sm opacity-60" />

            {/* Card */}
            <div
                className="relative rounded-2xl overflow-hidden
          bg-white/[0.03] backdrop-blur-xl
          border border-white/[0.08]
          shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
                style={{
                    borderImage: "linear-gradient(to bottom, rgba(255,255,255,0.15), transparent) 1",
                }}
            >
                {/* Header bar */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-[#009a22]" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                            Active Strategy
                        </span>
                    </div>
                    <span className="text-xs font-bold text-white/80 bg-white/[0.06] px-2.5 py-1 rounded-full">
                        Delta Neutral
                    </span>
                </div>

                {/* Main metric */}
                <div className="px-5 pt-5 pb-4">
                    <div className="flex items-baseline gap-2">
                        <TrendingUp className="w-5 h-5 text-[#009a22] self-center" />
                        <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 1.4, duration: 0.6 }}
                            className="text-4xl font-bold tabular-nums tracking-tight text-white"
                        >
                            14.2
                        </motion.span>
                        <span className="text-lg font-semibold text-neutral-400">% APY</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1.5 font-medium">
                        30-day rolling average · risk-adjusted
                    </p>
                </div>

                {/* Sub-metrics */}
                <div className="grid grid-cols-2 border-t border-white/[0.06]">
                    <div className="px-5 py-3.5 border-r border-white/[0.06]">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-0.5">
                            TVL
                        </p>
                        <p className="text-base font-bold tabular-nums text-white">
                            $4.2M
                        </p>
                    </div>
                    <div className="px-5 py-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-0.5">
                            Leverage
                        </p>
                        <p className="text-base font-bold tabular-nums text-white">
                            100x
                        </p>
                    </div>
                </div>

                {/* Bottom accent line */}
                <div className="h-px bg-gradient-to-r from-transparent via-[#009a22]/40 to-transparent" />
            </div>
        </motion.div>
    );
}
