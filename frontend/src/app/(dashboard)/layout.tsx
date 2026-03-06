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
        <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="ml-[220px] flex min-h-0 flex-1 flex-col overflow-hidden">
                <Header />
                <div className="no-scrollbar flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
            </div>
        </div>
    );
}
