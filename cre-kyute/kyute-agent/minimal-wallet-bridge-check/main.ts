import { CronCapability, Runner, handler } from "@chainlink/cre-sdk";
import { resolveWalletUserId } from "../../wallet-bridge.js";

type Config = { schedule?: string };
void resolveWalletUserId;

async function onCron(): Promise<string> {
  return "ok";
}

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule ?? "* * * * *" }), onCron)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
