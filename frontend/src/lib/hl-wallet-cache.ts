"use client";

export const HL_LAST_WALLET_KEY = "hl_last_wallet";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

export const getCachedWalletAddress = (): string | null => {
  if (typeof window === "undefined") return null;
  const raw = (window.localStorage.getItem(HL_LAST_WALLET_KEY) ?? "").trim();
  return WALLET_RE.test(raw) ? raw.toLowerCase() : null;
};

export const setCachedWalletAddress = (address?: string | null): void => {
  if (typeof window === "undefined") return;
  const value = (address ?? "").trim();
  if (!WALLET_RE.test(value)) return;
  window.localStorage.setItem(HL_LAST_WALLET_KEY, value.toLowerCase());
};

