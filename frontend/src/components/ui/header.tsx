"use client";

import { Button } from "@/components/ui/button";
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Menu, MoveRight, X, TrendingUp, ShieldCheck, Zap, BookOpen } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

function Header1() {
    const navigationItems = [
        {
            title: "Strategy",
            description: "Institutional-grade yield strategies powered by Chainlink CRE.",
            items: [
                {
                    title: "Live Arbs",
                    href: "/dashboard",
                    icon: <TrendingUp className="w-4 h-4" />
                },
                {
                    title: "Vault Health",
                    href: "/dashboard",
                    icon: <ShieldCheck className="w-4 h-4" />
                },
                {
                    title: "Yield History",
                    href: "/history",
                    icon: <Zap className="w-4 h-4" />
                },
            ],
        },
        {
            title: "Governance",
            description: "Kyute DAO and decentralized execution parameters.",
            items: [
                {
                    title: "Proposals",
                    href: "/settings",
                },
                {
                    title: "Voting",
                    href: "/settings",
                },
            ],
        },
        {
            title: "Resources",
            description: "Documentation and technical specifications.",
            items: [
                {
                    title: "Whitepaper",
                    href: "#",
                    icon: <BookOpen className="w-4 h-4" />
                },
                {
                    title: "API Docs",
                    href: "#",
                },
                {
                    title: "Security Audit",
                    href: "#",
                },
            ],
        },
    ];

    const [isOpen, setOpen] = useState(false);

    return (
        <header className="w-full z-[100] fixed top-0 left-0 bg-background/50 backdrop-blur-md border-b border-white/5">
            <div className="container relative mx-auto min-h-20 flex gap-4 flex-row lg:grid lg:grid-cols-3 items-center px-4">
                <div className="justify-start items-center gap-4 lg:flex hidden flex-row">
                    <NavigationMenu className="flex justify-start items-start">
                        <NavigationMenuList className="flex justify-start gap-4 flex-row">
                            {navigationItems.map((item) => (
                                <NavigationMenuItem key={item.title}>
                                    <NavigationMenuTrigger className="font-medium text-sm bg-transparent">
                                        {item.title}
                                    </NavigationMenuTrigger>
                                    <NavigationMenuContent className="!w-[450px] p-4 bg-black/90 backdrop-blur-xl border-white/10">
                                        <div className="flex flex-col lg:grid grid-cols-2 gap-4">
                                            <div className="flex flex-col h-full justify-between">
                                                <div className="flex flex-col">
                                                    <p className="text-base font-semibold text-white">{item.title}</p>
                                                    <p className="text-[#a1a1aa] text-sm mt-1">
                                                        {item.description}
                                                    </p>
                                                </div>
                                                <Button size="sm" className="mt-10 bg-[#009a22] hover:bg-[#009a22]/90 text-white border-0">
                                                    View Docs
                                                </Button>
                                            </div>
                                            <div className="flex flex-col text-sm h-full justify-end">
                                                {item.items?.map((subItem) => (
                                                    <NavigationMenuLink
                                                        href={subItem.href}
                                                        key={subItem.title}
                                                        className="flex flex-row justify-between items-center hover:bg-white/5 py-2 px-4 rounded transition-colors"
                                                    >
                                                        <span className="text-[#e4e4e7]">{subItem.title}</span>
                                                        <MoveRight className="w-4 h-4 text-[#71717a]" />
                                                    </NavigationMenuLink>
                                                ))}
                                            </div>
                                        </div>
                                    </NavigationMenuContent>
                                </NavigationMenuItem>
                            ))}
                        </NavigationMenuList>
                    </NavigationMenu>
                </div>
                <div className="flex lg:justify-center">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#009a22] to-emerald-900 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <TrendingUp className="w-5 h-5 text-white" />
                        </div>
                        <p className="font-bold text-xl tracking-tight text-white italic">Kyute</p>
                    </Link>
                </div>
                <div className="flex justify-end w-full gap-4">
                    <Button variant="ghost" className="hidden md:inline text-[#a1a1aa] hover:text-white">
                        Sign in
                    </Button>
                    <div className="border-r border-white/10 hidden md:inline h-6 self-center"></div>
                    <Link href="/dashboard">
                        <Button className="bg-[#009a22] hover:bg-[#009a22]/90 text-white font-semibold px-6 border-0">
                            Launch App
                        </Button>
                    </Link>
                </div>
                <div className="flex w-12 shrink lg:hidden items-center justify-end">
                    <Button variant="ghost" onClick={() => setOpen(!isOpen)} className="text-white">
                        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </Button>
                    {isOpen && (
                        <div className="absolute top-20 border-t border-white/10 flex flex-col w-full right-0 bg-black/95 backdrop-blur-2xl shadow-2xl py-6 px-4 container gap-8 z-[110]">
                            {navigationItems.map((item) => (
                                <div key={item.title}>
                                    <div className="flex flex-col gap-2">
                                        <p className="text-sm font-bold text-[#71717a] uppercase tracking-wider">{item.title}</p>
                                        {item.items &&
                                            item.items.map((subItem) => (
                                                <Link
                                                    key={subItem.title}
                                                    href={subItem.href}
                                                    className="flex justify-between items-center py-2 group"
                                                >
                                                    <span className="text-lg text-white group-hover:text-[#009a22] transition-colors">
                                                        {subItem.title}
                                                    </span>
                                                    <MoveRight className="w-4 h-4 stroke-1 text-[#71717a] group-hover:text-[#009a22] transition-all group-hover:translate-x-1" />
                                                </Link>
                                            ))}
                                    </div>
                                </div>
                            ))}
                            <div className="flex flex-col gap-4 mt-4 pt-6 border-t border-white/5">
                                <Button variant="outline" className="text-white border-white/10 bg-white/5">Sign in</Button>
                                <Link href="/dashboard" className="w-full">
                                    <Button className="w-full bg-[#009a22] hover:bg-[#009a22]/90 text-white border-0">Launch App</Button>
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

export { Header1 };
