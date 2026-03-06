import { CronCapability, Runner, handler } from "@chainlink/cre-sdk";

type Config = {
  schedule?: string;
};

async function onCron(): Promise<string> {
  console.log("minimal cron workflow ran");
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
