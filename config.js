const enums = require('./enums')

var config = {}

config.node = {
    url: valueOrDefault(process.env.NODE_URL, "http://localhost:3013/"),
    internal_url: valueOrDefault(process.env.NODE_INTERNAL_URL, "http://localhost:3113/"),
    compiler_url: valueOrDefault(process.env.COMPILER_URL, "http://localhost:3080"),
    network_id: valueOrDefault(process.env.NETWORK_ID, "ae_docker")
}

config.funders = valueOrDefault(process.env.FUNDERS, "bb9f0b01c8c9553cfbaf7ef81a50f977b1326801ebf7294d1c2cbccdedf27476e9bbf604e611b5460a3b3999e9771b6f60417d73ce7c5519e12f7e127a1225ca")
config.gift_amount = Number(valueOrDefault(process.env.GIFT_AMOUNT, 0.3))
config.http_port = Number(valueOrDefault(process.env.HTTP_PORT, 8130))
config.env = valueOrDefault(process.env.ENV, enums.ServiceEnv.DEV)

function valueOrDefault(value, defaultValue) {
    return (value !== undefined) ? value : defaultValue
}

module.exports = config
