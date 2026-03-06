import { CronCapability, handler } from "@chainlink/cre-sdk";

async function onCron(): Promise<void> {
  console.log("minimal cron workflow ran");
}

export async function main() {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: "* * * * *" }), onCron)];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
