let c
if (0) {
  c = {
    username: "x1c-heater",
    password: "0089a24833dedfd45baf936b771fad31",
  }
} else if (1) {
  c = {
    username: "xs/test",
    password: "0a72f93cfe4893c42c7021b0c5597b68",
  }
} else {
  c = {
    username: "rfgw/home",
    password: "bd26d72b04732e70a86debb2dc4ba899",
  }
}

const creds = {
  wifi: { ssid: "tve-home", password: "tve@home" },
  mqtt: {
    server: "mqtts://core.voneicken.com:4883",
    ...c,
  },
}

export default creds
