"use client";

import { motion } from "framer-motion";
import { Activity } from "lucide-react";

const marketData = [
    { label: "Binance Funding", value: "10.5%", color: "text-emerald-400" },
    { label: "Hyperliquid Rate", value: "18.5%", color: "text-sky-400" },
    { label: "Boros Implied", value: "12.0%", color: "text-violet-400" },
];

export function LiveArbitragePulse() {
    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.8, ease: "easeOut" }}
            className="inline-flex items-center gap-3 rounded-full 
        bg-white/[0.03] backdrop-blur-md border border-white/[0.08]
        px-5 py-2.5 shadow-[0_0_20px_rgba(0,154,34,0.05)]"
        >
            {/* Live indicator */}
            <div className="flex items-center gap-2 pr-3 border-r border-white/[0.08]">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#009a22] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#009a22]" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#009a22]">
                    Live
                </span>
            </div>

            {/* Market data items */}
            {marketData.map((item, i) => (
                <div key={item.label} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                            {item.label}
                        </span>
                        <span className={`text-xs font-bold tabular-nums ${item.color}`}>
                            {item.value}
                        </span>
                    </div>
                    {i < marketData.length - 1 && (
                        <div className="w-px h-3 bg-white/[0.08] ml-1" />
                    )}
                </div>
            ))}

            {/* Net Spread with pulse glow */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-white/[0.08]">
                <Activity className="w-3.5 h-3.5 text-[#009a22]" />
                <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                    Net Spread
                </span>
                <motion.span
                    animate={{
                        textShadow: [
                            "0 0 4px rgba(0,154,34,0)",
                            "0 0 12px rgba(0,154,34,0.6)",
                            "0 0 4px rgba(0,154,34,0)",
                        ],
                    }}
                    transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="text-sm font-bold tabular-nums text-[#009a22]"
                >
                    +6.5%
                </motion.span>
            </div>
        </motion.div>
    );
}
