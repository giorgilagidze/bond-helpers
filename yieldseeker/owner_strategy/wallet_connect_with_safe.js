import { SignClient } from "@walletconnect/sign-client";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createPublicClient, http, hashMessage, encodeAbiParameters } from "viem";
import { getSdkError } from "@walletconnect/utils";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const PROJECT_ID = "28d0f4867804355f1b7421b233ae10ec"; // replace with your own
const STRATEGY = "0xc1EEEd83e5bc08220D4897E666a8c59F5c68b48a";
const SAFE = "0x8985Cb046cC6DB2cEcD8288D683aF014DB27F369";
const OWNER_PK = 'PRIVATE_KEY_OF_STRATEGY_OWNER(WHICH IS SAFE IN THIS CASE), SO MEMBER_OF_SAFE'

if (!OWNER_PK) throw new Error("set OWNER_PK (the key that signs; strategy owner() or Safe signer)");

const account = privateKeyToAccount(OWNER_PK);
const pub = createPublicClient({ chain: base, transport: http("https://base-mainnet.g.alchemy.com/v2/kgf_Z0Kj2f7jvVGXrqhjM") });

const SAFE_ABI = [{
    name: "getMessageHashForSafe",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "safe", type: "address" }, { name: "message", type: "bytes" }],
    outputs: [{ name: "", type: "bytes32" }],
}];

async function signAsSafe(message) {
    const dataHash = hashMessage(message);
    const encodedDataHash = encodeAbiParameters([{ type: "bytes32" }], [dataHash]);
    const safeMessageHash = await pub.readContract({
        address: SAFE,
        abi: SAFE_ABI,
        functionName: "getMessageHashForSafe",
        args: [SAFE, encodedDataHash],
    });
    return account.sign({ hash: safeMessageHash });
}
console.log("wallet side ready");
console.log("  signing key :", account.address);
console.log("  exposing as :", STRATEGY);

const signClient = await SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
        name: "Strategy Wallet",
        description: "YieldSeeker strategy signer",
        url: "https://app.yieldseeker.xyz",
        icons: [],
    },
});

signClient.on("session_proposal", async ({ id, params }) => {
    console.log("\n<- session proposal from:", params.proposer.metadata?.name ?? "unknown");
    const acct = `eip155:${base.id}:${STRATEGY}`;
    const { topic, acknowledged } = await signClient.approve({
        id,
        namespaces: {
            eip155: {
                accounts: [acct],
                methods: ["personal_sign", "eth_sign", "eth_signTypedData", "eth_signTypedData_v4"],
                events: ["accountsChanged", "chainChanged"],
            },
        },
    });
    await acknowledged();
    console.log("-> session approved, exposed account:", acct, "\ntopic:", topic);
    console.log("\nnow trigger sign-in on YieldSeeker; sign requests will print here.\n");
});

signClient.on("session_request", async ({ topic, params, id }) => {
    const { request } = params;
    console.log("\n<- session_request:", request.method);

    if (request.method === "personal_sign" || request.method === "eth_sign") {
        const [a, b] = request.params;
        const hexMsg = request.method === "personal_sign" ? a : b;
        const message = Buffer.from(hexMsg.replace(/^0x/, ""), "hex").toString("utf8");
        console.log("---- message to sign ----\n" + message + "\n-------------------------");
        const signature = await signAsSafe(message);
        console.log("-> returning signature:", signature);
        await signClient.respond({ topic, response: { id, jsonrpc: "2.0", result: signature } });
        return;
    }

    console.log("!! unhandled method, rejecting:", request.method);
    await signClient.respond({
        topic,
        response: { id, jsonrpc: "2.0", error: getSdkError("WC_METHOD_UNSUPPORTED") },
    });
});

signClient.on("session_delete", () => console.log("session deleted by peer"));

const rl = readline.createInterface({ input, output });
const wcUri = (await rl.question("\nPaste the WalletConnect URI from YieldSeeker (wc:...):\n> ")).trim();
rl.close();

await signClient.core.pairing.pair({ uri: wcUri });
console.log("paired, waiting for proposal + sign requests... (Ctrl+C to exit)");
