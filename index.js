const server = require('./http/server')
const funder = require('./service/funder')

funder.start(async () => {
    server.start()
})
