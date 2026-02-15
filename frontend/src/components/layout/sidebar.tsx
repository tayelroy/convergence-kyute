"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Layers,
    History,
    Settings,
    TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Positions", href: "/positions", icon: Layers },
    { label: "History", href: "/history", icon: History },
    { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="fixed left-0 top-0 z-40 flex h-screen w-[220px] flex-col border-r border-white/[0.06] bg-[#07070a]">
            {/* Logo */}
            <Link
                href="/"
                className="flex items-center gap-2.5 px-6 py-6 border-b border-white/[0.06]"
            >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <span className="text-lg font-semibold tracking-tight text-white">
                    Kyute
                </span>
            </Link>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-1">
                {navItems.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/" && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                                isActive
                                    ? "bg-white/[0.08] text-white"
                                    : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"
                            )}
                        >
                            <item.icon
                                className={cn(
                                    "h-4 w-4",
                                    isActive ? "text-emerald-400" : "text-neutral-600"
                                )}
                            />
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            {/* Status Indicator */}
            <div className="border-t border-white/[0.06] px-4 py-4">
                <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-mono text-neutral-500">
                        CRE Active
                    </span>
                </div>
            </div>
        </aside>
    );
}
