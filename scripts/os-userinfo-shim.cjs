const os = require("node:os");

// Codex Windows sandboxes can deny uv_os_get_passwd even though HOME is valid.
os.userInfo = () => ({
  uid: -1,
  gid: -1,
  username: process.env.USERNAME || "USER",
  homedir: process.env.USERPROFILE || "C:\\Users\\USER",
  shell: null
});
