
"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

export function SavingsPortfolio() {
    // Mock Data (In prod, fetch from hook)
    const holdings = [
        { asset: "USDe", balance: 5043.21, apy: 15.4, risk: "Low" },
        { asset: "ATOM", balance: 1250.00, apy: 18.2, risk: "Medium" },
        { asset: "ETH", balance: 0.54, apy: 3.8, risk: "Low" },
    ];

    return (
        <div className="h-full w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white tracking-widest uppercase">My Savings</h2>
                <span className="text-xs text-[#666] font-mono">Total Value: $7,245.42</span>
            </div>

            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-[#1a1a1a] text-[#444] text-xs font-mono uppercase">
                        <th className="py-2 pl-2">Asset</th>
                        <th className="py-2">Balance</th>
                        <th className="py-2">Current APY</th>
                        <th className="py-2 text-right pr-2">Vol. Risk</th>
                    </tr>
                </thead>
                <tbody>
                    {holdings.map((h, i) => (
                        <motion.tr
                            key={h.asset}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="border-b border-[#111] hover:bg-[#0f0f0f] transition-colors"
                        >
                            <td className="py-3 pl-2 font-mono text-sm text-white">{h.asset}</td>
                            <td className="py-3 font-mono text-sm text-[#888]">{h.balance.toLocaleString()}</td>
                            <td className="py-3 font-mono text-sm text-[#00ff9d]">{h.apy}%</td>
                            <td className="py-3 pr-2 text-right">
                                <span
                                    className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded-sm ${h.risk === "High"
                                            ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                            : h.risk === "Medium"
                                                ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                                                : "bg-green-500/10 text-green-500 border border-green-500/20"
                                        }`}
                                >
                                    {h.risk}
                                </span>
                            </td>
                        </motion.tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
