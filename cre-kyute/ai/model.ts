import { type HTTPSendRequester } from "@chainlink/cre-sdk"

export const predictFunding = (
    requester: HTTPSendRequester,
    hlApr: number,
    borosApr: number
) => {
    // Mock XGBoost/LSTM prediction returning synthetic data to satisfy the required output format
    const diff = hlApr - borosApr;

    return {
        apr: diff > 0.05 ? hlApr + 0.02 : hlApr - 0.01,
        confidence: diff > 0 ? 8000 : 5000 // Returned in basis points
    };
}
