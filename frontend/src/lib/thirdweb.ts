import { createThirdwebClient } from "thirdweb";

const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;

export const client = clientId
  ? createThirdwebClient({
      clientId,
    })
  : null;

export const hasThirdwebClient = Boolean(clientId);
