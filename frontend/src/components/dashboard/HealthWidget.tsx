import React from "react";
import { ShieldCheck } from "lucide-react";

export function HealthWidget() {
    return (
        <div className="flex items-center space-x-3 bg-[#0a0a0a] border border-[#1a1a1a] px-4 py-2 rounded-sm w-fit">
            <div className="relative">
                <ShieldCheck size={18} className="text-[#00ff00]" />
                {/* Blinking dot */}
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff00] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ff00]"></span>
                </span>
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] text-[#666] uppercase tracking-widest font-bold">System Status</span>
                <span className="text-xs font-bold text-[#eee] tracking-wider">DON ACTIVE</span>
            </div>
        </div>
    );
}
