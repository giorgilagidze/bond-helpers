import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createPublicClient, http, hashMessage, encodeAbiParameters } from "viem";

const API = "https://api.yieldseeker.xyz";
const DOMAIN = "app.yieldseeker.xyz";
const URI = `https://${DOMAIN}`;

const WALLET_ADDRESS = "0xD2792E8F0dDABeB263B7F269aaaac02B1D1fFDD9"; // AGENT STRATEGY
const SAFE = "0x8985Cb046cC6DB2cEcD8288D683aF014DB27F369"; // bond credit safe
const PK = 'PRIVATE_KEY_OF_OWNER_OF_SAFE'
const account = privateKeyToAccount(PK);
const pub = createPublicClient({ chain: base, transport: http("https://base-mainnet.g.alchemy.com/v2/kgf_Z0Kj2f7jvVGXrqhjM") });

const SAFE_ABI = [{
    name: "getMessageHashForSafe",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "safe", type: "address" }, { name: "message", type: "bytes" }],
    outputs: [{ name: "", type: "bytes32" }],
}];

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

async function authHeader() {
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const message = siweMessage(WALLET_ADDRESS, nonce, new Date().toISOString());

    const dataHash = hashMessage(message);
    const encodedDataHash = encodeAbiParameters([{ type: "bytes32" }], [dataHash]);
    const safeMessageHash = await pub.readContract({
        address: SAFE,
        abi: SAFE_ABI,
        functionName: "getMessageHashForSafe",
        args: [SAFE, encodedDataHash],
    });
    const signature = await account.sign({ hash: safeMessageHash });

    return Buffer.from(JSON.stringify({ message, signature })).toString("base64");
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

const signatureString = await authHeader();
const auth = `Signature ${signatureString}`;
const username = `user_${WALLET_ADDRESS.slice(2, 15).toLowerCase()}`;

let user;
try {
    const res = await api("/v1/users/login-with-wallet", {
        method: "POST",
        auth,
        body: { walletAddress: WALLET_ADDRESS },
    });
    user = res.user; // userId, createdDate, username, name
    console.log("login-with-wallet:", JSON.stringify(user, null, 2));
} catch (err) {
    if (!err.message.includes("NO_USER")) {
        throw err;
    }

    console.log("no user for wallet, registering...");
    const created = await api("/v1/users", {
        method: "POST",
        body: {
            referralCode: null,
            signatureString,
            username,
            walletAddress: WALLET_ADDRESS,
        },
    });
    console.log("register:", JSON.stringify(created, null, 2));

    const res = await api("/v1/users/login-with-wallet", {
        method: "POST",
        auth,
        body: { walletAddress: WALLET_ADDRESS },
    });
    user = res.user;
    console.log("login-with-wallet (after register):", JSON.stringify(user, null, 2));
}

const existing = await api(`/v1/users/${user.userId}/agents`, { auth });
const firstAgent = existing.agents?.[0];

if (firstAgent) {
    user.agentId = firstAgent.agentId;
    console.log("existing agent:", JSON.stringify(firstAgent, null, 2));
} else {
    const agent = await api(`/v1/users/${user.userId}/agents`, {
        method: "POST",
        auth,
        body: {
            assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            chainId: 8453,
            emoji: "🚀",
            name: "Agent 0",
            rulePreset: "conservative",
            type: "vault",
        },
    });
    user.agentId = agent.agent.agentId;
    console.log("create agent:", JSON.stringify(agent, null, 2));
}
console.log("agentId:", user.agentId);

const wallet = await api(`/v1/users/${user.userId}/agents/${user.agentId}/wallet`, { auth });
user.walletAddress = wallet.agentWallet.walletAddress;
console.log("wallet:", JSON.stringify(wallet, null, 2));
console.log("walletAddress:", user.walletAddress);
console.log(user);

const deploy = await api(`/v1/users/${user.userId}/agents/${user.agentId}/deploy`, {
    method: "POST",
    auth,
});
console.log("deploy:", JSON.stringify(deploy, null, 2));
