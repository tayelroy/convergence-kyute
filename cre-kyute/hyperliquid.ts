import { type HTTPSendRequester } from "@chainlink/cre-sdk"

export const fetchHyperliquidFundingHistory = (requester: HTTPSendRequester, coin: string) => {
    const payload = JSON.stringify({ type: "predictedFundings" })

    const response = requester.sendRequest({
        url: "https://api.hyperliquid.xyz/info",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(payload).toString("base64"),
        cacheSettings: {
            store: true,
            maxAge: "30s",
        },
    }).result()

    const jsonStr = new TextDecoder().decode(response.body)
    const data = JSON.parse(jsonStr) as any[]

    const coinData = data.find((item: any) => item[0] === coin)
    if (!coinData) return 0

    const venues = coinData[1] as any[]
    const hlPerpEntry = venues.find((v: any) => v[0] === "HlPerp")
    if (!hlPerpEntry) return 0

    const fundingRate = Number(hlPerpEntry[1].fundingRate)
    return fundingRate * 24 * 365
}
