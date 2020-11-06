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
        logger.info(`Initialized worker ${workerId} with wallet ${publicKey}.`)
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

    logger.info(`WORKER-${workerId}: Funding ${wallets.length} wallet(s)...`)

    let results = []
    for (wallet of wallets) {
        logger.info(`WORKER-${workerId}: Sending ${config.gift_amount} to wallet ${wallet}`)
        let [result, err] = await handle(client.spend(amount, wallet))
        if (err) {
            logger.warn(`WORKER-${workerId}: Error while sending funds to wallet ${wallet}: %o`, err)
            throw new Error(err)
        }
        logger.info(`Send to wallet ${wallet} result: %o`, result)
        results.push(result)
    }

    return results
}

const handle = (promise) => {
    return promise
      .then(data => ([data, undefined]))
      .catch(error => Promise.resolve([undefined, error]));
}

module.exports = { start, stop, autoFunderQueue, funderWallets }
