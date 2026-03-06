"use client";

import { useMemo } from "react";
import { getContract } from "thirdweb";
import { useReadContract } from "thirdweb/react";
import { formatUnits } from "viem";
import { kyuteVaultChain } from "@/lib/chains";
import { client } from "@/lib/thirdweb";
import { getKyuteVaultAddress, VAULT_ABI } from "@/lib/kyute-vault";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

type RawVaultPosition = readonly [
  string,
  boolean,
  bigint,
  bigint,
  boolean,
  string,
  bigint,
  bigint,
  bigint,
  boolean,
  boolean,
];

export function useKyuteVaultState(userAddress?: string) {
  const vaultAddress = getKyuteVaultAddress();
  const vaultContract = useMemo(() => {
    if (!client || !vaultAddress) return null;
    return getContract({
      client,
      address: vaultAddress,
      chain: kyuteVaultChain,
      abi: VAULT_ABI,
    });
  }, [vaultAddress]);

  const { data: totalAssetsData } = useReadContract({
    contract: vaultContract!,
    method: "totalAssets",
    params: [],
    queryOptions: { enabled: Boolean(vaultContract) },
  });

  const { data: sharesData } = useReadContract({
    contract: vaultContract!,
    method: "balanceOf",
    params: [userAddress ?? ZERO_ADDRESS],
    queryOptions: { enabled: Boolean(vaultContract && userAddress) },
  });

  const { data: userAssetsData } = useReadContract({
    contract: vaultContract!,
    method: "convertToAssets",
    params: [sharesData ?? BigInt(0)],
    queryOptions: { enabled: Boolean(vaultContract && userAddress && sharesData !== undefined) },
  });

  const { data: userPositionData } = useReadContract({
    contract: vaultContract!,
    method: "userPositions",
    params: [userAddress ?? ZERO_ADDRESS],
    queryOptions: { enabled: Boolean(vaultContract && userAddress) },
  });

  const position = (userPositionData ?? null) as RawVaultPosition | null;
  const totalAssetsWei = (totalAssetsData as bigint | undefined) ?? BigInt(0);
  const userAssetsWei = (userAssetsData as bigint | undefined) ?? BigInt(0);
  const sharesWei = (sharesData as bigint | undefined) ?? BigInt(0);

  return {
    configured: Boolean(vaultContract && vaultAddress),
    vaultAddress,
    totalAssetsWei,
    totalAssetsEth: Number(formatUnits(totalAssetsWei, 18)),
    userAssetsWei,
    userAssetsEth: Number(formatUnits(userAssetsWei, 18)),
    sharesWei,
    hasPosition: Boolean(position && position[2] > BigInt(0)),
    hasBorosHedge: Boolean(position && position[4]),
    hlNotionalWei: position?.[2] ?? BigInt(0),
    hlNotionalEth: Number(formatUnits(position?.[2] ?? BigInt(0), 18)),
    currentHedgeNotionalWei: position?.[8] ?? BigInt(0),
    currentHedgeAmountYu: Number(formatUnits(position?.[8] ?? BigInt(0), 18)),
    currentHedgeIsLong: position?.[9] ?? false,
    positionLastUpdate: position?.[6] ? Number(position[6]) * 1000 : null,
  };
}
