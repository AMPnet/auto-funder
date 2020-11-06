const server = require('./http/server')
const funder = require('./service/funder')

async function start() {
    await server.start()
    await funder.start()
}

start()
