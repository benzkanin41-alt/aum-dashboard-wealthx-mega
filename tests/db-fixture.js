import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "../server-lib/local-paths.js";

export function testEnv(name) {
  const folder = path.join(DATA_ROOT, "tests", "databases");
  mkdirSync(folder, { recursive: true });
  const sqlite = new DatabaseSync(path.join(folder, `${name}-${Date.now()}-${crypto.randomUUID()}.sqlite`));
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f=>f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const env = {
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        const bind = (...args) => ({
          bind,
          async first(column) { const row=statement.get(...args); return row ? (column ? row[column] : {...row}) : null; },
          async all() { return {results: statement.all(...args).map(row=>({...row}))}; },
          async run() { const result=statement.run(...args); return {success:true,meta:{changes:Number(result.changes)}}; }
        });
        return bind();
      },
      async batch(statements) { sqlite.exec("BEGIN");try { const result=[];for(const s of statements)result.push(await s.run());sqlite.exec("COMMIT");return result; }catch(e){sqlite.exec("ROLLBACK");throw e;} }
    },
    FILES: { async put() {} },
    close:()=>sqlite.close()
  };
  return env;
}

export async function seedModelFixture(env) {
  const now="2026-09-17T00:00:00Z";
  await env.DB.prepare("INSERT INTO funds (id,code,bucket_id,bucket_name,data_source,inception_date,created_at,updated_at) VALUES ('TEST','TEST','wealthx_other','WealthX SeriesX','test','2026-01-01',?,?)").bind(now,now).run();
  for (const [i,y] of [205,370,630,760,1060,1195,1450].entries()) {
    const date=`2026-0${i+1}-01`;
    await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,inserted_at) VALUES ('TEST',?,?,?)").bind(date,100*(i+1),now).run();
    await env.DB.prepare("INSERT INTO aua_observations(id,reference_date,amount_million_baht,announced_at,discovered_at,status,label,observation_key,revision,created_at,updated_at) VALUES (?,?,?,?,?,'verified','Test',?,1,?,?)")
      .bind(`actual-${i}`,date,y,date,now,`${date}:${y}`,now,now).run();
  }
  await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,inserted_at) VALUES ('TEST','2026-07-02',750,?)").bind(now).run();
}
