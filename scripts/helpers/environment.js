const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { DeploymentError } = require("../../config/evm-networks.cjs");

function loadEnvironment(env = process.env, root = path.resolve(__dirname, "../..")) {
  const profile = env.EVM_PROFILE || "testnet";
  if (!["testnet", "production"].includes(profile)) throw new DeploymentError("EVM_PROFILE must be testnet or production");
  const named = path.join(root, `.env.${profile}`);
  const file = fs.existsSync(named) ? named : profile === "testnet" ? path.join(root, ".env") : null;
  const values = file && fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  if (values.EVM_PROFILE && values.EVM_PROFILE !== profile) throw new DeploymentError("Env file profile conflicts with the selected EVM_PROFILE");
  // Validate before merging: production never falls back to the developer .env.
  if (profile === "production") {
    for (const [key,value] of [...Object.entries(values),...Object.entries(env)]) {
      if (value && /PRIVATE_KEY|MNEMONIC|SEED_PHRASE/i.test(key)) throw new DeploymentError("Raw signing secrets are prohibited in the production profile");
    }
    for (const [key,value] of Object.entries(values)) {
      if (value && /SECRET|PASSWORD|API_KEY|TOKEN$|RPC_URL$/i.test(key)) throw new DeploymentError("Inject production credentials and RPC endpoints through a protected runtime, not an env file");
    }
  }
  for (const [key,value] of Object.entries(values)) if (env[key] === undefined) env[key] = value;
  env.EVM_PROFILE = profile;
  return profile;
}
module.exports = { loadEnvironment };
