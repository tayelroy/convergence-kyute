"use client";

import { useState, useEffect } from "react";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { TradeSignal } from "@/types/boros";

export function useTradeSignals(maxSignals = 50) {
    const [signals, setSignals] = useState<TradeSignal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            const q = query(
                collection(db, "trade_signals"),
                orderBy("timestamp", "desc"),
                limit(maxSignals)
            );

            const unsubscribe = onSnapshot(
                q,
                (snapshot) => {
                    const data = snapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    })) as TradeSignal[];
                    setSignals(data);
                    setLoading(false);
                },
                (err) => {
                    console.error("Firestore listener error:", err);
                    setError(err.message);
                    setLoading(false);
                }
            );

            return () => unsubscribe();
        } catch (err) {
            console.error("Failed to initialize Firestore listener:", err);
            setError("Firebase not configured");
            setLoading(false);
        }
    }, [maxSignals]);

    return { signals, loading, error };
}
