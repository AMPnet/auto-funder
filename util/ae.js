const fromExponential = require('from-exponential')

const config = require('../config')
const logger = require('../logger')(module)

const tokenFactor = 1000000000000000000

function toAettos(amount) {
    return fromExponential(amount * tokenFactor)
}

async function waitForTxConfirm(hash, client, maxAttempts = 3) {
    try {
        let numberOfConfirmations = config.confirmations
        logger.info(`Waiting for transaction ${hash}; Number of confirmations: ${numberOfConfirmations}; Attempts left: ${maxAttempts};`)
        if (maxAttempts == 0) throw new Error(`Error: Waiting for transaction ${hash} confirmation timed out...`)
        let pollResult = await client.poll(hash, { blocks: 10, interval: 10000 })
        logger.debug(`Transaction ${hash} poll result: %o`, pollResult)
        let currentHeight = await client.waitForTxConfirm(hash, { confirm: numberOfConfirmations, interval: 10000, attempts: 20 })
        logger.debug(`Wait for ${hash} tx confirm result: ${currentHeight}`)
        let txInfo = await client.tx(hash)
        logger.debug(`Fetched tx info again for ${hash}. Result: %o`, txInfo)
        if (txInfo.blockHeight === -1 || (currentHeight - txInfo.blockHeight) < numberOfConfirmations) {
            logger.warn(`Height does not look good for transaction ${hash}. Executing recursive call...`)
            return await waitForTxConfirm(hash, client, maxAttempts - 1)
        } else {
            return txInfo
        }
    } catch(err) {
        if (maxAttempts > 0) {
            return await waitForTxConfirm(hash, client, maxAttempts - 1)
        } else {
            throw new Error(`Error while checking for transaction ${hash}. 0 attempts left, giving up...`)
        }
    }
}

module.exports = { toAettos, waitForTxConfirm }