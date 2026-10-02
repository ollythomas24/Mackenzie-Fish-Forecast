import { getStore, getDeployStore } from "@netlify/blobs";
import { createHandler } from "../lib/handler.mjs";

export const config = { path: "/api/*" };

let handler;

function open(name) {
  // Real data lives in global stores on production; other deploys get their own scratch data.
  const isProd = Netlify.context?.deploy?.context === "production";
  return isProd ? getStore({ name, consistency: "strong" }) : getDeployStore({ name, consistency: "strong" });
}

export default async (req) => {
  if (!handler) {
    handler = createHandler({
      stores: { users: open("users"), sessions: open("sessions"), catches: open("catches"), photos: open("photos") },
      env: { SIGNUP_CODE: Netlify.env.get("SIGNUP_CODE") || "" },
    });
  }
  return handler(req);
};
