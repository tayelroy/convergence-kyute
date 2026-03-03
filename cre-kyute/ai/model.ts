import { type HTTPSendRequester } from "@chainlink/cre-sdk"

export const predictFundingFromAprs = (hlApr: number, borosApr: number) => {
    const diff = hlApr - borosApr

    return {
        apr: diff > 0.05 ? hlApr + 0.02 : hlApr - 0.01,
        confidence: diff > 0 ? 8000 : 5000
    }
}

export const predictFunding = (
    requester: HTTPSendRequester,
    hlApr: number,
    borosApr: number
) => {
    return predictFundingFromAprs(hlApr, borosApr)
}
