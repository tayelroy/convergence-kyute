import { CronCapability, Runner, handler } from "@chainlink/cre-sdk";

type Config = { schedule?: string };

async function onCron(runtime: any): Promise<string> {
  runtime.log("async check start");
  await Promise.resolve();
  runtime.log("async check after await");
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
