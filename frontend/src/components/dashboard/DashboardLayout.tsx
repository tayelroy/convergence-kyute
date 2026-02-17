import React from "react";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
    children: React.ReactNode;
    className?: string;
}

export function DashboardLayout({ children, className }: DashboardLayoutProps) {
    return (
        <div className={cn("h-full w-full bg-[#050505] text-slate-200 font-mono overflow-hidden", className)}>
            {/* Scanlines / CRT Effect Overlay (optional, subtle) */}
            <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] opacity-10" />

            <div className="relative z-10 flex flex-col h-full">
                {children}
            </div>
        </div>
    );
}
