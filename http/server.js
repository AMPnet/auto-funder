const express = require('express')
const actuator = require('express-actuator')
const prometheus = require('prom-client')
const { Node, Universal, MemoryAccount, Crypto } = require('@aeternity/aepp-sdk')

const config = require('../config')
const logger = require('../logger')(module)
const funder = require('../service/funder')

var expr
var httpServer
var aeClient

async function start() {
    expr = express()
    expr.use(express.urlencoded({ extended: true }))
    expr.use(express.json())
    expr.use(actuator())
    logger.info(`Health info and basic metrics available at /info and /metrics`)

    await initializeAeClient()
    
    addPrometheusRoute()
    addWalletBalancesRoute()

    httpServer = await expr.listen(config.http_port)
    logger.info(`HTTP server started at port ${config.http_port}.`)
}

async function initializeAeClient() {
    let aeNode = await Node({
        url: config.node.url,
        internalUrl: config.node.internal_url
    })
    let randomWallet = Crypto.generateKeyPair()
    aeClient = await Universal({
        nodes: [ { name: "node", instance: aeNode } ],
        compilerUrl: config.node.compiler_url,
        accounts: [
            MemoryAccount({ keypair: randomWallet })
        ],
        address: randomWallet.publicKey,
        networkId: config.node.network_id
    })
}

function addPrometheusRoute() {
    prometheus.register.clear()
    prometheus.collectDefaultMetrics()
    const prometheusEndpoint = '/prometheus'
    expr.get(prometheusEndpoint, (req, res) => {
        res.set('Content-Type', prometheus.register.contentType)
        res.end(prometheus.register.metrics())
    })
    logger.info(`Prometheus endpoint available at ${prometheusEndpoint}`)
}

function addWalletBalancesRoute() {
    const walletBalancesEndpoint = '/funders'
    expr.get(walletBalancesEndpoint, async (req, res) => {
        logger.info(`Received request to fetch funder balances.`)
        let response = {}
        let balanceQueries = funder.funderWallets.map(wallet => {
            return new Promise(async (resolve) => {
                let balance = await aeClient.balance(wallet, {
                    format: 'ae'
                })
                logger.info(`balance(${wallet}) = ${balance}`)
                response[wallet] = `${balance} AE`
                resolve()
            })
        })
        await Promise.all(balanceQueries)
        res.json(response)
    })
    logger.info(`Wallet balances available at ${walletBalancesEndpoint}`)
}

async function stop() {
    return httpServer.close()
}

module.exports = { start, stop }