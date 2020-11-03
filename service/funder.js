const PgBoss = require('pg-boss')
const { Universal, Keystore, Node, TxBuilder, MemoryAccount } = require('@aeternity/aepp-sdk')

const aeUtil = require('../util/ae')
const config = require('../config')
const logger = require('../logger')(module)

const autoFunderQueue = "ampnet-auto-funder-queue"

var queue
var funderWallets = []

async function start(onComplete) {
    logger.info(`Starting Funder service.`)
    await initQueue()
    await initWorkers()
    if (onComplete !== undefined) {
        await onComplete()
    }
}

async function stop() {
    return queue.stop()
}

async function initQueue() {
    queue = new PgBoss(config.queue_db)
    await queue.start()
    logger.info(`Queue initialized.`)
}

async function initWorkers() {
    let keys = config.funders.trim().split(":")
    let keysCount = keys.length
    logger.info(`Loaded ${keysCount} worker wallets.`)

    // await queue.onComplete(
    //     autoFunderQueue,
    //     {
    //         teamSize: keysCount,
    //         teamConcurrency: keysCount,
    //         newJobCheckIntervalSeconds: 3
    //     },
    //     jobComplete
    // )
    // logger.info(`Initialized job complete handler.`)

    let aeNode = await Node({
        url: config.node.url,
        internalUrl: config.node.internal_url
    })
    let workerId = 1
    for (secretKey of keys) {
        let publicKey = Keystore.getAddressFromPriv(secretKey)
        funderWallets.push(publicKey)
        let client = await Universal({
            nodes: [
                { name: "node", instance: aeNode }
            ],
            compilerUrl: config.node.compiler_url,
            accounts: [
                MemoryAccount({ keypair: {
                    publicKey,
                    secretKey
                } })
            ],
            address: publicKey,
            networkId: config.node.network_id
        })
        let id = workerId.valueOf()
        await queue.subscribe(
            autoFunderQueue,
            {
                teamSize: 1,
                teamConcurrency: 1,
                newJobCheckIntervalSeconds: 2
            },
            async (job) => {
                return handleJob(client, job, id)
            }
        )
        logger.info(`Initialized worker ${workerId}.`)
        workerId++
    }
}

async function handleJob(client, job, workerId) {
    logger.info(`WORKER-${workerId}: Processing job with id ${job.id}`)
    
    let wallets = job.data.wallets
    let amount = aeUtil.toAettos(config.gift_amount)
    
    if (wallets.length === 0) {
        logger.info(`WORKER-${workerId}: No wallets provided for auto-funding. Ignoring job.`)
        return
    }
    if (amount === 0) {
        logger.info(`WORKER-${workerId}: Funding amount set to 0AE. Ignoring job.`)
        return
    }

    let senderAddress = await client.address()
    logger.info(`WORKER-${workerId}: Sending ${amount} aettos to ${wallets.length} wallet(s) from wallet ${senderAddress}`)

    let senderBalance = await client.getBalance(senderAddress)
    logger.info(`WORKER-${workerId}: Sender balance ${senderBalance}`)

    let nonce = await client.getAccountNonce(senderAddress)
    logger.info(`WORKER-${workerId}: Sender nonce ${nonce}`)
    
    let transactions = []
    let totalCost = 0
    for (wallet of wallets) {
        let tx = await client.spendTx({
            senderId: senderAddress,
            recipientId: wallet,
            amount: amount,
            nonce: nonce
        })
        let params = TxBuilder.unpackTx(tx).tx
        let signedTx = await client.signTransaction(tx)

        transactions.push(signedTx)
        totalCost += (Number(params.fee) + Number(params.amount))
        nonce++
    }
    logger.info(`WORKER-${workerId}: Total cost of sending ${wallets.length} spend transaction(s) is ${totalCost}`)

    if (totalCost > senderBalance) {
        logger.error(`WORKER-${workerId}: Error while funding wallets. Insufficient balance on supervisor account. Ignoring job.`)
        return
    }

    let jobs = []
    for (t of transactions) {
        jobs.push(
            client.sendTransaction(t, { verify: false })
        )
    }

    logger.info(`WORKER-${workerId}: Transaction(s) broadcasted. Waiting for status mined...`)
    return Promise.all(jobs)
}

// async function jobComplete(job) {
//     if (job.data.failed) {
//         logger.error(`Job ${job.data.request.id} failed. Full output: %o`, job)
//         return
//     }

//     let jobData = job.data.request.data
//     if (jobData.originTxHash === undefined) {
//         logger.info(`Job ${job.data.request.id} completed!`)
//         return
//     }

//     logger.info(`Job ${job.data.request.id} completed!`)
//     logger.info(`Updating origin transaction ${jobData.originTxHash} supervisor status to PROCESSED.`)
//     return repo.update({
//         hash: jobData.originTxHash,
//         from_wallet: jobData.originTxFromWallet,
//         to_wallet: jobData.originTxToWallet
//     },
//     { supervisor_status: enums.SupervisorStatus.PROCESSED })
// }

module.exports = { start, stop, autoFunderQueue, funderWallets }
