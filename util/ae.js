const fromExponential = require('from-exponential')

const tokenFactor = 1000000000000000000

function toAettos(amount) {
    return fromExponential(amount * tokenFactor)
}

module.exports = { toAettos }