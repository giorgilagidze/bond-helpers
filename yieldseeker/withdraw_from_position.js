import { createWalletClient, hashMessage, http, publicActions, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const API = "https://api.yieldseeker.xyz";
const DOMAIN = "app.yieldseeker.xyz";
const URI = `https://${DOMAIN}`;

const USER_ID = "d93c653e-6c26-4b26-aad2-c3d8d4630a67"; // get this from network tab on app.yieldseeker once logged in with safe
const AGENT_ID = "b2ad39d4-808b-4baa-a3a7-28571ab52b0b"; // // get this from network tab on app.yieldseeker once logged in with safe
const SAFE = "0x8985Cb046cC6DB2cEcD8288D683aF014DB27F369";

const account = privateKeyToAccount("PRIVATE_KEY_OF_SAFE_OWNER");
const client = createWalletClient({ account, chain: base, transport: http("https://base-mainnet.g.alchemy.com/v2/kgf_Z0Kj2f7jvVGXrqhjM") }).extend(publicActions);

function siweMessage(address, nonce, issuedAt) {
    return [
        `${DOMAIN} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "I have read and agree to the YieldSeeker Terms of Service",
        "",
        `URI: ${URI}`,
        "Version: 1",
        `Chain ID: ${base.id}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
    ].join("\n");
}

const SAFE_ABI = [
    {
        name: "getMessageHashForSafe",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "safe", type: "address" },
            { name: "message", type: "bytes" },
        ],
        outputs: [
            { name: "", type: "bytes32" },
        ],
    },
    {
        name: "isValidSignature",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "hash", type: "bytes32" },
            { name: "signature", type: "bytes" },
        ],
        outputs: [
            { name: "magic", type: "bytes4" },
        ],
    },
]

async function authHeader() {
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const message = siweMessage(SAFE, nonce, new Date().toISOString());
    const dataHash = hashMessage(message);
    const encodedDataHash = encodeAbiParameters(
        [{ type: "bytes32" }],
        [dataHash]
    );

    const safeMessageHash = await client.readContract({
        address: SAFE,
        abi: SAFE_ABI,
        functionName: "getMessageHashForSafe",
        args: [
            SAFE,
            encodedDataHash,
        ],
    });

    const signature = await account.sign({
        hash: safeMessageHash,
    });

    console.log(signature)
    const result = await client.readContract({
        address: SAFE,
        abi: SAFE_ABI,
        functionName: "isValidSignature",
        args: [
            dataHash,
            signature,
        ],
    });

    console.log("\nisValidSignature:");
    console.log(
        result,
        result === "0x1626ba7e"
            ? "VALID"
            : "INVALID"
    );

    console.log("isValidSignature:", result, result === "0x1626ba7e" ? "VALID" : "INVALID");

    const token = Buffer.from(
        JSON.stringify({
            message,
            signature,
        })
    ).toString("base64");

    return `Signature ${token}`;
}

async function api(path, { method = "GET", body, auth } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`);
    return parsed;
}

const auth = await authHeader();
console.log("signer:", account.address);

const agents = await api(`/v1/users/${USER_ID}/agents`, { auth });
console.log("agents:", JSON.stringify(agents, null, 2));

const positions = await api(
    `/v1/users/${USER_ID}/agents/${AGENT_ID}/yield-positions`,
    { auth },
);
console.log("positions:", JSON.stringify(positions, null, 2));

// if (process.env.YS_VAULT && process.env.YS_AMOUNT) {
//     const out = await api(
//         `/v1/users/${USER_ID}/agents/${AGENT_ID}/withdraw-from-position`,
//         {
//             method: "POST",
//             auth,
//             body: { chainId: base.id, vaultAddress: process.env.YS_VAULT, assetsRaw: Number(process.env.YS_AMOUNT) },
//         },
//     );
//     console.log("withdrawFromPosition:", JSON.stringify(out, null, 2));
// }
