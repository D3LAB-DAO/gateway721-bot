require("dotenv").config();

const { Secp256k1HdWallet } = require("@cosmjs/amino");
const { SigningCosmWasmClient } = require("@cosmjs/cosmwasm-stargate");
const { calculateFee, GasPrice } = require("@cosmjs/stargate");
const axios = require('axios');

const corsOptions = {
    origin: '*',
    credentials: true,
    optionSuccessStatus: 200,
};

// Load and validate environment variables
const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.CONTRACT_ADDRESS;
const mnemonic = process.env.MNEMONIC;
const apiKey = process.env.OPENAI_API_KEY;

if (!rpcUrl || !contractAddress || !mnemonic || !apiKey) {
    console.error("Missing required environment variables.");
    process.exit(1);
}

const exitIfTimeout = async (promise, timeout) => {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
};

const handleError = (error, message) => {
    console.error(`${message}:`, error);
    process.exit(1);
};

// Set gas price and execution fee
const gasPrice = GasPrice.fromString("140000000000aarch");
// const gasPrice = GasPrice.fromString("140000000000aconst");
const executeFee = calculateFee(300_000, gasPrice);

const bot = async () => {
    const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, { prefix: "archway" });
    const [{ address }] = await wallet.getAccounts();
    const client = await SigningCosmWasmClient.connectWithSigner(rpcUrl, wallet);

    while (true) {
        // Get ramaining ids
        let pids;
        try {
            pids = (await getIncompleteProjects(client)).pids;
            console.log(`Projects: [${pids}]`);
        } catch (error) {
            handleError(error, 'Error during ID monitoring');
        }

        for (let project of pids) {
            // Get Nft Info
            let nftInfo;
            try {
                nftInfo = await getNftInfo(client, project.toString());
            } catch (error) {
                handleError(error, 'Error during getNftInfo');
            }

            try {
                const query = `Explain this function with title and short description:
${nftInfo.extension.code}

---

Answer in this format. Do not answer any other words:
{\"title\": \"/*title*/\", \"description\": \"/*short description under 40 words*/\"}

Example input:
function addNumbers(params) { const { a, b } = params; return a + b; } mainFunction = addNumbers;

Example output:
{\"title\": \"Simple Addition\", \"description\": \"Simply add two inputs and return the result.\"}`;

                const answer = JSON.parse(await callChatGPT(apiKey, query));
                console.log(answer);

                // Send response
                const execRes = await updateDetails(client, address, project, answer.title, answer.description);
                console.log(`Transaction Hash: ${execRes.transactionHash}`);
                // const tokenId = execRes.logs[0].events.find(e => e.type === 'wasm').attributes.find(attr => attr.key === 'token_id').value;
                // console.log('Token ID:', tokenId);
            } catch (error) {
                console.error('Error sending transaction', error);
                console.log(`skip - Token: ${project}`);
                // TODO: connection retry
            }
        }

        // Wait for 20 seconds before checking for new requests again
        await new Promise((resolve) => setTimeout(resolve, 20000));
    }
};

const getIncompleteProjects = async (client, token_id, timeout = 60000) => {
    const queryResult = await exitIfTimeout(client.queryContractSmart(contractAddress, {
        "incomplete_projects": {}
    }), timeout);
    return queryResult ? queryResult : null;
};

const getNftInfo = async (client, token_id, timeout = 60000) => {
    const queryResult = await exitIfTimeout(client.queryContractSmart(contractAddress, {
        "nft_info": { "token_id": token_id }
    }), timeout);
    return queryResult ? queryResult : null;
};

const updateDetails = async (client, senderAddress, token_id, title, description, timeout = 60000) => {
    const msg = {
        "update": {
            "token_id": token_id,
            "title": title,
            "description": description
        }
    };
    const executeResult = await exitIfTimeout(client.execute(
        senderAddress,
        contractAddress,
        msg,
        executeFee
    ), timeout);
    return executeResult ? executeResult : null;
};

const callChatGPT = async (apiKey, content, timeout = 60000) => {
    const url = 'https://api.openai.com/v1/chat/completions';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
    const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: content }],
        max_tokens: 150,
    });

    const response = await exitIfTimeout(axios.post(url, body, { headers }), timeout);
    return response.data.choices[0].message.content;
};

// Graceful shutdown
const shutdown = () => {
    console.log('Shutting down...');
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Call the bot function
bot().catch(error => handleError(error, 'Unhandled error in bot'));
