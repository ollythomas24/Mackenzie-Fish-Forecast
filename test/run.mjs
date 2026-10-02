import { run as api } from "./api.test.mjs";
await api();
try {
  const { run: astro } = await import("./astro.test.mjs");
  await astro();
} catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
}
