
"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

export function GuardianControls() {
    const [isActive, setIsActive] = useState(false);

    return (
        <div className={`p-4 rounded-sm border transition-all duration-300 ${isActive ? "border-[#00ff9d] bg-[#00ff9d]/5" : "border-[#333] bg-[#0a0a0a]"}`}>
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-white font-bold text-sm tracking-wider">AUTO-GUARD</h3>
                    <p className="text-[10px] text-[#666] font-mono mt-1">Autonomous Hedging Agent</p>
                </div>

                <button
                    onClick={() => setIsActive(!isActive)}
                    className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${isActive ? "bg-[#00ff9d]" : "bg-[#333]"}`}
                >
                    <motion.div
                        layout
                        className="w-4 h-4 bg-black rounded-full shadow-lg"
                    />
                </button>
            </div>

            <div className="mt-4 border-t border-[#222] pt-3">
                <div className="flex justify-between text-[10px] font-mono text-[#888]">
                    <span>Safety Threshold</span>
                    <span className="text-white">75 RISK SCORE</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-[#888] mt-1">
                    <span>Max Hedge Size</span>
                    <span className="text-white">0.5 ETH</span>
                </div>
            </div>

            {isActive && (
                <div className="mt-3 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff9d] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ff9d]"></span>
                    </span>
                    <span className="text-[10px] text-[#00ff9d] font-mono">AGENT MONITORING...</span>
                </div>
            )}
        </div>
    );
}
