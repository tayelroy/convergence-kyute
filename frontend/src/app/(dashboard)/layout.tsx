"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useHlOpenPosition } from "@/hooks/use-hl-open-position";
import { getCachedWalletAddress } from "@/lib/hl-wallet-cache";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const account = useActiveAccount();
    const fallbackWallet = getCachedWalletAddress();
    const walletForGate = account?.address ?? fallbackWallet ?? undefined;
    const { loading, hasOpenPosition } = useHlOpenPosition(walletForGate);

    useEffect(() => {
        if (loading) return;
        if (!walletForGate) {
            router.replace("/?reason=connect_wallet");
            return;
        }
        if (!hasOpenPosition) {
            router.replace("/onboarding?reason=open_position");
        }
    }, [walletForGate, hasOpenPosition, loading, router]);

    if (loading || !walletForGate || !hasOpenPosition) {
        return (
            <div className="min-h-screen bg-[#07070a] text-neutral-300 flex items-center justify-center">
                <p className="font-mono text-sm text-neutral-500">Checking access requirements...</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 ml-[220px]">
                <Header />
                <main className="p-6">{children}</main>
            </div>
        </div>
    );
}
