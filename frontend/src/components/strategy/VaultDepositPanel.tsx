"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Coins, Wallet } from "lucide-react";
import { getContract, prepareContractCall } from "thirdweb";
import {
  TransactionButton,
  useActiveAccount,
  useActiveWalletChain,
  useInvalidateContractQuery,
  useReadContract,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { formatUnits, isAddress, parseUnits } from "viem";
import { kyuteVaultChain, kyuteVaultChainLabel } from "@/lib/chains";
import { client, hasThirdwebClient } from "@/lib/thirdweb";
import { ERC20_ABI, formatAddress, getKyuteCollateralAddress, getKyuteVaultAddress, VAULT_ABI } from "@/lib/kyute-vault";
import { cn } from "@/lib/utils";

const UNRESOLVED_ADDRESS = "0x0000000000000000000000000000000000000001" as const;
const DEMO_FAUCET_REFRESH_EVENT = "kyute-demo-faucet-funded";

const trimAmount = (value: string) =>
  value.includes(".") ? value.replace(/\.?0+$/, "") : value;

const formatTokenAmount = (value: bigint | undefined, decimals: number, fallback = "0") => {
  if (value === undefined) return fallback;
  return trimAmount(formatUnits(value, decimals));
};

const parseAmount = (raw: string, decimals: number) => {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > BigInt(0) ? parsed : null;
  } catch {
    return null;
  }
};

const actionButtonClassName =
  "inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border px-4 text-xs font-mono uppercase tracking-[0.22em] transition-colors";

export function VaultDepositPanel() {
  const vaultAddress = getKyuteVaultAddress();

  if (!hasThirdwebClient || !client || !vaultAddress) {
    return (
      <aside className="rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_40%),linear-gradient(180deg,#0d1214,#090b0f)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-emerald-300/70">Vault funding rail</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Deposit collateral</h2>
        <div className="mt-4 rounded-[24px] border border-yellow-400/15 bg-yellow-400/8 px-4 py-4 text-sm leading-6 text-yellow-100/85">
          Missing `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` or `NEXT_PUBLIC_KYUTE_VAULT_ADDRESS`, so the live approve/deposit rail cannot be initialized.
        </div>
      </aside>
    );
  }

  return <ConfiguredVaultDepositPanel vaultAddress={vaultAddress} />;
}

function ConfiguredVaultDepositPanel({ vaultAddress }: { vaultAddress: `0x${string}` }) {
  const account = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchActiveWalletChain = useSwitchActiveWalletChain();
  const invalidateContractQuery = useInvalidateContractQuery();
  const [amount, setAmount] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [pendingChainSwitch, setPendingChainSwitch] = useState(false);
  const [nonceRefreshVersion, setNonceRefreshVersion] = useState(0);
  const [chainNonce, setChainNonce] = useState<number | null>(null);
  const [isNoncePending, setIsNoncePending] = useState(false);
  const [nonceError, setNonceError] = useState<string | null>(null);
  const configuredCollateralAddress = getKyuteCollateralAddress();
  const walletOnVaultChain = activeChain?.id === kyuteVaultChain.id;
  const readChain = walletOnVaultChain && activeChain ? activeChain : kyuteVaultChain;

  const vaultContract = useMemo(
    () =>
      getContract({
        client: client!,
        address: vaultAddress,
        chain: readChain,
        abi: VAULT_ABI,
      }),
    [readChain, vaultAddress],
  );

  const {
    data: assetAddress,
    isPending: isAssetReadPending,
    error: assetReadError,
  } = useReadContract({
    contract: vaultContract!,
    method: "asset",
    params: [],
    queryOptions: { enabled: Boolean(vaultContract) },
  });

  const resolvedAssetAddress =
    typeof assetAddress === "string" && isAddress(assetAddress)
      ? (assetAddress as `0x${string}`)
      : configuredCollateralAddress;

  const assetContract = useMemo(() => {
    return getContract({
      client: client!,
      address: resolvedAssetAddress ?? UNRESOLVED_ADDRESS,
      chain: readChain,
      abi: ERC20_ABI,
    });
  }, [readChain, resolvedAssetAddress]);

  const { data: symbolData } = useReadContract({
    contract: assetContract!,
    method: "symbol",
    params: [],
    queryOptions: { enabled: Boolean(resolvedAssetAddress) },
  });
  const { data: decimalsData } = useReadContract({
    contract: assetContract,
    method: "decimals",
    params: [],
    queryOptions: { enabled: Boolean(resolvedAssetAddress) },
  });
  const { data: balanceData } = useReadContract({
    contract: assetContract,
    method: "balanceOf",
    params: [account?.address ?? "0x0000000000000000000000000000000000000000"],
    queryOptions: { enabled: Boolean(resolvedAssetAddress) && Boolean(account?.address) },
  });
  const { data: allowanceData } = useReadContract({
    contract: assetContract,
    method: "allowance",
    params: [account?.address ?? "0x0000000000000000000000000000000000000000", vaultAddress],
    queryOptions: { enabled: Boolean(resolvedAssetAddress) && Boolean(account?.address) },
  });
  const { data: sharesData } = useReadContract({
    contract: vaultContract!,
    method: "balanceOf",
    params: [account?.address ?? "0x0000000000000000000000000000000000000000"],
    queryOptions: { enabled: Boolean(vaultContract && account?.address) },
  });
  const { data: depositedAssetsData } = useReadContract({
    contract: vaultContract!,
    method: "convertToAssets",
    params: [sharesData ?? BigInt(0)],
    queryOptions: { enabled: Boolean(vaultContract && sharesData !== undefined) },
  });
  const { data: totalAssetsData } = useReadContract({
    contract: vaultContract!,
    method: "totalAssets",
    params: [],
    queryOptions: { enabled: Boolean(vaultContract) },
  });

  const symbol = typeof symbolData === "string" && symbolData.length > 0 ? symbolData : "COLL";
  const decimals = Number(decimalsData ?? 18);
  const balance = balanceData as bigint | undefined;
  const allowance = allowanceData as bigint | undefined;
  const amountWei = useMemo(() => parseAmount(amount, decimals), [amount, decimals]);
  const needsApproval = amountWei !== null && allowance !== undefined ? allowance < amountWei : false;
  const insufficientBalance = amountWei !== null && balance !== undefined ? balance < amountWei : false;
  const invalidAmount = amount.trim().length > 0 && amountWei === null;
  const hasAmount = amountWei !== null;

  const refreshContracts = useCallback(() => {
    if (vaultAddress) {
      invalidateContractQuery({ chainId: kyuteVaultChain.id, contractAddress: vaultAddress });
    }
    if (resolvedAssetAddress) {
      invalidateContractQuery({ chainId: kyuteVaultChain.id, contractAddress: resolvedAssetAddress });
    }
  }, [invalidateContractQuery, resolvedAssetAddress, vaultAddress]);

  useEffect(() => {
    const onRefresh = () => {
      refreshContracts();
      setStatusMessage("Demo faucet funded this wallet. Approve and deposit are ready once you switch to the vault chain.");
    };

    window.addEventListener(DEMO_FAUCET_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DEMO_FAUCET_REFRESH_EVENT, onRefresh);
  }, [refreshContracts]);

  const totalAssetsLabel = formatTokenAmount(totalAssetsData as bigint | undefined, decimals, "--");
  const balanceLabel = formatTokenAmount(balance, decimals, "--");
  const allowanceLabel = formatTokenAmount(allowance, decimals, "--");
  const depositedLabel = formatTokenAmount(depositedAssetsData as bigint | undefined, decimals, "--");
  const sharesLabel = formatTokenAmount(sharesData as bigint | undefined, decimals, "--");
  const isCorrectChain = activeChain?.id === kyuteVaultChain.id;
  const needsChainSwitch = Boolean(account) && !isCorrectChain;
  const needsNonceResolution = Boolean(account) && isCorrectChain;
  const nonceUnavailable = needsNonceResolution && (isNoncePending || chainNonce === null);
  const approveDisabled =
    !account || !isCorrectChain || !hasAmount || invalidAmount || insufficientBalance || !needsApproval || nonceUnavailable;
  const depositDisabled =
    !account || !isCorrectChain || !hasAmount || invalidAmount || insufficientBalance || needsApproval || nonceUnavailable;
  const isResolvingAsset = isAssetReadPending && !resolvedAssetAddress;
  const assetReadErrorMessage =
    assetReadError instanceof Error
      ? assetReadError.message
      : assetReadError
        ? String(assetReadError)
        : null;
  const disabledActionReason =
    !account
      ? "Connect a wallet to approve and deposit."
      : needsChainSwitch
        ? `Switch to ${kyuteVaultChainLabel} before approving or depositing.`
        : isNoncePending
          ? "Resolving current on-chain nonce..."
          : nonceError
            ? `Unable to read on-chain nonce: ${nonceError}`
        : !hasAmount
          ? "Enter a deposit amount first."
          : invalidAmount
            ? "Enter a valid positive deposit amount."
            : insufficientBalance
              ? "Wallet balance is below the requested deposit."
              : needsApproval
                ? `Approve ${symbol} before depositing.`
                : null;

  useEffect(() => {
    if (!pendingChainSwitch) return;
    if (activeChain?.id !== kyuteVaultChain.id) return;
    refreshContracts();
    setNonceRefreshVersion((version) => version + 1);
    setStatusMessage(`Wallet switched to ${kyuteVaultChainLabel}.`);
    setPendingChainSwitch(false);
    setIsSwitching(false);
  }, [activeChain?.id, pendingChainSwitch, refreshContracts]);

  useEffect(() => {
    if (!needsChainSwitch) return;
    if (statusMessage === `Wallet switched to ${kyuteVaultChainLabel}.`) {
      setStatusMessage(null);
    }
  }, [needsChainSwitch, statusMessage]);

  useEffect(() => {
    if (!account?.address || !isCorrectChain) {
      setChainNonce(null);
      setNonceError(null);
      setIsNoncePending(false);
      return;
    }

    const controller = new AbortController();
    setIsNoncePending(true);
    setNonceError(null);

    void fetch(`/api/wallet-nonce?walletAddress=${account.address}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; nonce?: number; error?: string };
        if (!response.ok || !body.ok || !Number.isFinite(body.nonce)) {
          throw new Error(body.error ?? `wallet-nonce failed (${response.status})`);
        }
        setChainNonce(Number(body.nonce));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setChainNonce(null);
        setNonceError(error instanceof Error ? error.message : "Unknown nonce error");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsNoncePending(false);
      });

    return () => controller.abort();
  }, [account?.address, isCorrectChain, nonceRefreshVersion]);

  const onSwitchChain = async () => {
    try {
      setIsSwitching(true);
      setPendingChainSwitch(true);
      setStatusMessage(null);
      await switchActiveWalletChain(kyuteVaultChain);
    } catch (error) {
      setPendingChainSwitch(false);
      setIsSwitching(false);
      setStatusMessage(error instanceof Error ? error.message : `Failed to switch to ${kyuteVaultChainLabel}.`);
    }
  };

  return (
    <aside className="rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_40%),linear-gradient(180deg,#0d1214,#090b0f)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-emerald-300/70">Vault funding rail</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Deposit collateral</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            Approve the vault asset, then deposit it into the ERC4626 vault so Boros positions can draw against your own vault collateral.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-right">
          <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-emerald-300/70">Target chain</p>
          <p className="mt-1 text-sm font-medium text-emerald-200">{kyuteVaultChainLabel}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label="Vault" value={formatAddress(vaultAddress, 5)} icon={<Wallet className="h-4 w-4" />} />
        <Metric label={`Total assets (${symbol})`} value={totalAssetsLabel} icon={<Coins className="h-4 w-4" />} />
        <Metric label={`Wallet balance (${symbol})`} value={balanceLabel} icon={<Wallet className="h-4 w-4" />} />
        <Metric label="Vault receipts" value={sharesLabel} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <div className="mt-4 rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[10px] font-mono uppercase tracking-[0.24em] text-neutral-500" htmlFor="vault-deposit-amount">
            Deposit amount
          </label>
          <button
            type="button"
            onClick={() => setAmount(balanceLabel === "--" ? "" : balanceLabel)}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-neutral-300 transition-colors hover:bg-white/8"
          >
            Max
          </button>
        </div>

        <div className="mt-3 rounded-[22px] border border-white/10 bg-[#07090d] px-4 py-3">
          <div className="flex items-end justify-between gap-3">
            <input
              id="vault-deposit-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="25.0"
              className="w-full bg-transparent text-3xl font-semibold tracking-tight text-white outline-none placeholder:text-neutral-700"
            />
            <span className="pb-1 text-sm font-mono uppercase tracking-[0.22em] text-emerald-200/80">{symbol}</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-neutral-500">
            <span>Approved</span>
            <span>{allowanceLabel} {symbol}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-neutral-500">
            <span>Your vault claim</span>
            <span>{depositedLabel} {symbol}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {needsChainSwitch ? (
            <button
              type="button"
              onClick={() => void onSwitchChain()}
              disabled={isSwitching}
              className={cn(
                actionButtonClassName,
                "border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/16",
                isSwitching ? "cursor-wait opacity-70" : "",
              )}
            >
              {isSwitching ? `Switching to ${kyuteVaultChainLabel}` : `Switch to ${kyuteVaultChainLabel}`}
            </button>
          ) : null}

          {isResolvingAsset ? (
            <div className="rounded-2xl border border-neutral-400/15 bg-neutral-400/8 px-4 py-3 text-sm text-neutral-200/80">
              Resolving vault asset on {kyuteVaultChainLabel}...
            </div>
          ) : !needsChainSwitch && resolvedAssetAddress ? (
            <>
              <TransactionButton
                transaction={() =>
                  prepareContractCall({
                    contract: assetContract,
                    method: "approve",
                    params: [vaultAddress, amountWei ?? BigInt(0)],
                    nonce: chainNonce ?? undefined,
                  })
                }
                disabled={approveDisabled}
                onTransactionConfirmed={() => {
                  refreshContracts();
                  setNonceRefreshVersion((version) => version + 1);
                  setStatusMessage(`Collateral approved for ${formatAddress(vaultAddress, 5)}.`);
                }}
                onError={(error) => {
                  setStatusMessage(error.message);
                }}
                unstyled
                className={cn(
                  actionButtonClassName,
                  approveDisabled
                    ? "cursor-not-allowed border-white/8 bg-white/[0.04] text-neutral-500 opacity-60"
                    : needsApproval
                      ? "border-cyan-400/30 bg-cyan-400/12 text-cyan-200 hover:bg-cyan-400/18"
                      : "border-white/8 bg-white/[0.04] text-neutral-500",
                )}
              >
                {needsApproval ? `Approve ${symbol}` : "Allowance ready"}
              </TransactionButton>

              <TransactionButton
                transaction={() =>
                  prepareContractCall({
                    contract: vaultContract,
                    method: "deposit",
                    params: [amountWei ?? BigInt(0), account?.address ?? "0x0000000000000000000000000000000000000000"],
                    nonce: chainNonce ?? undefined,
                  })
                }
                disabled={depositDisabled}
                onTransactionConfirmed={() => {
                  refreshContracts();
                  setNonceRefreshVersion((version) => version + 1);
                  setStatusMessage(`Deposited ${amount.trim()} ${symbol} into the vault.`);
                  setAmount("");
                }}
                onError={(error) => {
                  setStatusMessage(error.message);
                }}
                unstyled
                className={cn(
                  actionButtonClassName,
                  depositDisabled
                    ? "cursor-not-allowed border-white/8 bg-white/[0.04] text-neutral-500 opacity-60"
                    : "border-emerald-400/30 bg-emerald-400/14 text-emerald-100 hover:bg-emerald-400/20",
                )}
              >
                Deposit into vault
              </TransactionButton>
            </>
          ) : needsChainSwitch ? null : (
            <div className="rounded-2xl border border-yellow-400/15 bg-yellow-400/8 px-4 py-3 text-sm text-yellow-100/80">
              The vault asset could not be resolved yet. Make sure the configured vault is reachable on {kyuteVaultChainLabel}.
              {assetReadErrorMessage ? ` (${assetReadErrorMessage})` : ""}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2 text-[11px] font-mono">
          {invalidAmount ? <p className="text-amber-300/90">Enter a valid positive amount.</p> : null}
          {insufficientBalance ? <p className="text-rose-300/90">Wallet balance is below the requested deposit.</p> : null}
          {!account ? <p className="text-neutral-400">Connect the wallet you want to fund from.</p> : null}
          {needsChainSwitch ? (
            <p className="text-amber-200/90">
              Wallet is on chain {activeChain?.id ?? "unknown"}. Switch to {kyuteVaultChainLabel} before approve and deposit.
            </p>
          ) : null}
          {!needsChainSwitch && disabledActionReason ? <p className="text-amber-200/90">{disabledActionReason}</p> : null}
          {statusMessage ? <p className="text-emerald-200/90">{statusMessage}</p> : null}
          <p className="text-neutral-500">
            In demo mode the vault runs on local Anvil. Your wallet must be switched to the vault chain before approve and deposit can succeed.
          </p>
        </div>
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-neutral-500">
        <span className="text-emerald-300/80">{icon}</span>
        {label}
      </div>
      <p className="mt-3 text-lg font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}
