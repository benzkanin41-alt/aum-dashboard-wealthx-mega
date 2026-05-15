import { refreshAll } from "../server-lib/sec-refresh.js";

refreshAll({ full: true })
  .then((status) => {
    console.log(JSON.stringify(status, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
