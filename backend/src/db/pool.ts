import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});
