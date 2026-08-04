import { Queue, ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

// bullmq bundles its own copy of ioredis for type purposes, which can end up
// a different version than the one in our own node_modules. They're
// structurally identical at runtime but TypeScript treats them as distinct
// nominal types (private/protected fields), hence the cast.
export const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;

export const pollQueue = new Queue("router-poll", { connection });

// Schedules a recurring "poll all routers" tick. Call once on worker startup.
export async function scheduleRecurringPoll() {
  await pollQueue.add(
    "poll-all",
    {},
    {
      repeat: { every: config.pollIntervalMs },
      removeOnComplete: true,
      removeOnFail: 50,
      jobId: "poll-all-recurring",
    }
  );
}
