const { Crypto, Node, Universal, MemoryAccount } = require("@aeternity/aepp-sdk")
const Bull = require('bull')
const axios = require('axios')
const chai = require('chai')
const assert = chai.assert

const httpServer = require('../http/server')
const funder = require('../service/funder')
const config = require('../config')
const aeUtil = require('../util/ae')

describe('Auto funding test', function() {

    beforeEach(async() => {
        await funder.start()
        await httpServer.start()

        serverQueue = new Bull(funder.autoFunderQueueServer, {
            redis: {
                host: config.redis.host,
                port: config.redis.port
            }
        })
        clientQueue = new Bull(funder.autoFunderQueueClient, {
            redis: {
                host: config.redis.host,
                port: config.redis.port
            }
        })
        
        await serverQueue.empty()
        await clientQueue.empty()
        for (workerQueue of funder.workerQueues) {
            await workerQueue.empty()
        }
    })

    afterEach(async() => {
        await httpServer.stop()
        await funder.stop()
    })

    it("should fund wallets provided in job request and update state of origin tx if required", async () => {

        let wallet1 = Crypto.generateKeyPair()
        let wallet2 = Crypto.generateKeyPair()
        let wallet3 = Crypto.generateKeyPair()
        let wallet4 = Crypto.generateKeyPair()
        let aeClient = await getAeClient()
        
        serverQueue.add({
            wallets: [ wallet1.publicKey, wallet2.publicKey ],
            originTxHash: "xyz"
        }).then(job => {
            console.log(`Job ${job.id} published.`)
        }).catch(err => { console.log("Error while publishing job: ", err) })
        
        serverQueue.add({
            wallets: [ wallet3.publicKey, wallet4.publicKey ]
        }).then(job => {
            console.log(`Job ${job.id} published.`)
        }).catch(err => { console.log("Error while publishing job: ", err) })

        clientQueue.process(async function (job) {
            console.log(`Job ${job.id} completed.`)
            console.log(`Job data: `, job.data)
        })

        await sleep(15000)

        const giftAmount = aeUtil.toAettos(config.gift_amount)
        let wallet1Balance = await aeClient.balance(wallet1.publicKey)
        let wallet2Balance = await aeClient.balance(wallet2.publicKey)
        let wallet3Balance = await aeClient.balance(wallet3.publicKey)
        let wallet4Balance = await aeClient.balance(wallet4.publicKey)

        assert.strictEqual(wallet1Balance, giftAmount)
        assert.strictEqual(wallet2Balance, giftAmount)
        assert.strictEqual(wallet3Balance, giftAmount)
        assert.strictEqual(wallet4Balance, giftAmount)

        let funderBalancesUrl = `http://0.0.0.0:${config.http_port}/funders`
        let funderBalances = (await axios.get(funderBalancesUrl)).data
        for (wallet of funder.funderWallets) {
            assert.isTrue(funderBalances.hasOwnProperty(wallet))
        }

        await serverQueue.close()
        await clientQueue.close()
    })
})

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAeClient() {
    let aeNode = await Node({
        url: config.node.url,
        internalUrl: config.node.internal_url
    })
    let randomWallet = Crypto.generateKeyPair()
    return Universal({
        nodes: [
            { name: "node", instance: aeNode }
        ],
        compilerUrl: config.node.compiler_url,
        accounts: [
            MemoryAccount({ keypair: randomWallet })
        ],
        address: randomWallet.publicKey,
        networkId: config.node.network_id
    })
}