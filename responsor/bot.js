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
        // Get token length
        let numTokens;
        try {
            numTokens = (await getNumTokens(client)).count;
            console.log(`Token Length: ${numTokens}`);
        } catch (error) {
            handleError(error, 'Error during getNumTokens');
        }

        // foreach token
        let range = n => Array.from({ length: n }, (_, i) => i);
        for (let project of range(numTokens)) {
            // Get Nft Info
            let nftInfo;
            try {
                nftInfo = await getNftInfo(client, project.toString());
            } catch (error) {
                handleError(error, 'Error during getNftInfo');
            }

            // Get remains
            let remains;
            try {
                remains = (await getRemains(client, project.toString())).tids;
                console.log(`Task Remains: [${remains}]`);
            } catch (error) {
                handleError(error, 'Error during getRemains');
            }

            // Iterate over each task
            for (let tid of remains) {
                console.log(`start - Token: ${project} | Task: ${tid}`);
                const task = nftInfo.extension.tasks[tid];
                console.log(task);

                let inputs;
                let output;

                try {
                    // Parse task inputs
                    inputs = JSON.parse(task.input);

                    try {
                        // Get output from localhost:3327
                        const response = await axios.post('http://localhost:3327/run', {
                            code: nftInfo.extension.code,
                            inputs: inputs
                        });

                        output = response.data || "Fail to run.";
                        if (typeof output !== "string") {
                            output = output.toString();
                        }
                        console.log(`Answer: ${output}`);
                    } catch (error) {
                        console.error('Error during output fetching or type conversion', error);
                        continue;
                    }
                } catch (error) {
                    console.error('Error parsing task inputs', error);
                    output = "Fail to run.";
                }

                try {
                    // Send response
                    const execRes = await setResponse(client, address, project.toString(), task.tid, output);
                    console.log(`Transaction Hash: ${execRes.transactionHash}`);
                } catch (error) {
                    console.error('Error sending transaction', error);
                    console.log(`skip - Token: ${project} | Task: ${tid}`);
                    // TODO: connection retry
                }
            }
        }

        // Wait for 20 seconds before checking for new requests again
        await new Promise((resolve) => setTimeout(resolve, 20000));
    }
};

const getNumTokens = async (client, timeout = 60000) => {
    const queryResult = await exitIfTimeout(client.queryContractSmart(contractAddress, { "num_tokens": {} }), timeout);
    return queryResult ? queryResult : null;
};

const getRemains = async (client, token_id, timeout = 60000) => {
    const queryResult = await exitIfTimeout(client.queryContractSmart(contractAddress, {
        "remains": { "token_id": token_id }
    }), timeout);
    return queryResult ? queryResult : null;
};

const getNftInfo = async (client, token_id, timeout = 60000) => {
    const queryResult = await exitIfTimeout(client.queryContractSmart(contractAddress, {
        "nft_info": { "token_id": token_id }
    }), timeout);
    return queryResult ? queryResult : null;
};

const setResponse = async (client, senderAddress, token_id, task_id, output) => {
    console.log(token_id, task_id, output);
    const msg = {
        "response": {
            "token_id": token_id,
            "task_id": task_id,
            "output": output
        }
    };
    const executeResult = await client.execute(
        senderAddress,
        contractAddress,
        msg,
        executeFee
    );
    return executeResult ? executeResult : null;
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
