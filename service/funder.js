const Bull = require('bull')
const { Universal, Keystore, Node, MemoryAccount } = require('@aeternity/aepp-sdk')

const aeUtil = require('../util/ae')
const config = require('../config')
const logger = require('../logger')(module)

const autoFunderQueueServer = "ampnet-auto-funder-queue-server"
const autoFunderQueueClient = "ampnet-auto-funder-queue-client"

var serverQueue
var clientQueue
var workerQueues = []
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
    logger.info(`Stopping Funder service.`)
    await serverQueue.close()
    await clientQueue.close()
    for (workerQueue of workerQueues) {
        await workerQueue.close()
    }
}

async function initQueue() {
    serverQueue = new Bull(autoFunderQueueServer)
    clientQueue = new Bull(autoFunderQueueClient)

    serverQueue.process(handleJob)
    serverQueue.on('failed', function(job, err) {
        logger.warn(`MASTER-QUEUE: Job ${job.id} failed with error: %o`, err)
    })
    serverQueue.on('error', function(err) {
        logger.warn(`MASTER-QUEUE: Error occured %o`, err)
    })
    logger.info(`Queues initialized.`)
}

async function initWorkers() {
    let keys = config.funders.trim().split(":")
    let keysCount = keys.length
    logger.info(`Loaded ${keysCount} worker wallets.`)

    let aeNode = await Node({
        url: config.node.url,
        internalUrl: config.node.internal_url
    })
    logger.info(`Loaded node`)
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
        logger.info(`Loaded client`)
        let id = workerId.valueOf()
        let workerQueue = new Bull(`worker-${id}`)
        workerQueue.process(async (job) => {
            return handleWorkerJob(client, job, id)
        })
        workerQueue.on('completed', handleWorkerJobComplete)
        workerQueue.on('error', function(err) {
            logger.warn(`Worker queue error: %o`, err)
        })
        workerQueue.on('failed', function(job, err) {
            logger.warn(`Job ${job.id} failed. Error log: %o`, err)
        })
        logger.info(`Initialized worker ${workerId} with wallet ${publicKey}.`)
        workerId++
        workerQueues.push(workerQueue)
    }
}

async function handleJob(job) {
    logger.info(`MASTER-QUEUE: Processing job ${job.id}`)
    let workerQueueId = 0
    let workerQueuesCount = workerQueues.length
    if (workerQueuesCount > 1) {
        let initialJobCounts = await workerQueues[0].getJobCounts() 
        let minJobsCount = initialJobCounts.waiting + initialJobCounts.active
        for (let i = 1; i < workerQueuesCount; i++) {
            let jobCounts = await workerQueues[i].getJobCounts()
            let jobsTotal = jobCounts.waiting + jobCounts.active
            if (jobsTotal < minJobsCount) {
                minJobsCount = jobsTotal
                workerQueueId = i.valueOf()
            }
        }
    }
    workerQueues[workerQueueId].add(job.data).then(result => {
        logger.info(`MASTER-QUEUE: Forwarded job ${job.id} to WORKER-${workerQueueId + 1} queue. Forwarded job id: ${result.id}`)
    }).catch(err => {
        logger.warn(`MASTER-QUEUE: Error while forwarding job ${job.id} to WORKER-${workerQueueId + 1} queue: %o`, err)
    })
}

async function handleWorkerJob(client, job, workerId) {
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

    logger.info(`WORKER-${workerId}: Funding ${wallets.length} wallet(s) ${wallets}`)

    let results = []
    let walletsCount = wallets.length
    for (let i = 0; i < walletsCount; ++i) {
        let wallet = wallets[i]
        logger.info(`WORKER-${workerId}: Sending ${config.gift_amount} to wallet ${wallet}`)
        let [result, err] = await handle(client.spend(amount, wallet))
        if (err) {
            logger.warn(`WORKER-${workerId}: Error while sending funds to wallet ${wallet}: %o`, err)
            throw new Error(err)
        }
        logger.info(`WORKER-${workerId}: Send to wallet ${wallet} result: %o`, result)
        results.push(result)
    }

    return results
}

async function handleWorkerJobComplete(job) {
    logger.info(`Job ${job.id} complete!`)
    clientQueue.add(job.data).then(result => {
        logger.info(`Forwarded completed job ${job.id} to client queue. New job id ${result.id}`)
    }).catch(err => {
        logger.warn(`Error while forwarding job ${job.id} to client queue: %o`, err)
    })
}

const handle = (promise) => {
    return promise
      .then(data => ([data, undefined]))
      .catch(error => Promise.resolve([undefined, error]));
}

module.exports = { start, autoFunderQueueServer, autoFunderQueueClient, funderWallets, workerQueues, stop }
