import { BorosBackend } from "@pendle/sdk-boros"

type FetchBorosImpliedAprOptions = {
    marketAddress?: string
    coreApiUrl?: string
}

const normalizeApr = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return value > 3 ? value / 100 : value
}

const pickMarket = (
    markets: Array<any>,
    coin: string,
    marketAddress?: string,
) => {
    if (!Array.isArray(markets) || markets.length === 0) return undefined

    if (marketAddress) {
        const target = marketAddress.toLowerCase()
        const byAddress = markets.find((market) => String(market?.address ?? "").toLowerCase() === target)
        if (byAddress) return byAddress
    }

    const normalizedCoin = coin.toUpperCase()
    const matching = markets.filter((market) => {
        const metadataSymbol = String(market?.metadata?.assetSymbol ?? "").toUpperCase()
        const fundingSymbol = String(market?.metadata?.fundingRateSymbol ?? "").toUpperCase()
        const marketSymbol = String(market?.imData?.symbol ?? "").toUpperCase()
        return (
            metadataSymbol === normalizedCoin ||
            fundingSymbol === normalizedCoin ||
            marketSymbol.includes(normalizedCoin)
        )
    })

    if (matching.length === 0) return undefined

    const withImplied = matching.find((market) => {
        const value = Number(market?.data?.ammImpliedApr)
        return Number.isFinite(value) && value > 0
    })

    return withImplied ?? matching[0]
}

export const fetchBorosImpliedApr = async (
    coin: string,
    options: FetchBorosImpliedAprOptions = {},
): Promise<number> => {
    if (options.coreApiUrl) {
        BorosBackend.setCoreBackendUrl(options.coreApiUrl)
    }

    const coreSdk = BorosBackend.getCoreSdk()
    const response = await coreSdk.markets.marketsControllerGetMarkets({
        isWhitelisted: true,
        limit: 200,
    })

    const selectedMarket = pickMarket(response.data.results ?? [], coin, options.marketAddress)
    if (!selectedMarket) {
        throw new Error(`No Boros market found for coin ${coin}`)
    }

    const impliedAprRaw = Number(
        selectedMarket?.data?.ammImpliedApr ?? selectedMarket?.data?.markApr,
    )

    if (!Number.isFinite(impliedAprRaw)) {
        throw new Error(`Boros market ${selectedMarket.address} has no implied APR value`)
    }

    return normalizeApr(impliedAprRaw)
}
