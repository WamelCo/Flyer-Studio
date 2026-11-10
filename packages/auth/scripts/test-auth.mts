/**
 * Sign-in codes by email (SMTP and Resend) and phone-number handling.
 *   pnpm --filter @flyer/auth test
 * The SMTP test talks to a tiny in-process SMTP server, so it needs no account or network.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Socket } from "node:net";

import { closeDb, isDatabaseUnavailable } from "@flyer/db";

import { emailConfigured, sendEmailCode } from "../src/email";
import { describeError } from "../src/logger";
import { normalizePhone } from "../src/phone";
import { formatPhone, studioNumber } from "../src/gateway";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** Just enough SMTP to accept one message: greeting, EHLO, AUTH, MAIL, RCPT, DATA, QUIT. */
function fakeSmtp() {
  const received: { from: string; to: string; data: string; auth: string }[] = [];
  const server = createServer((socket: Socket) => {
    let mode: "command" | "data" = "command";
    let current = { from: "", to: "", data: "", auth: "" };
    let buffer = "";
    socket.write("220 fake.smtp ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (mode === "data") {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          received.push(current);
          current = { from: "", to: "", data: "", auth: current.auth };
          mode = "command";
          socket.write("250 queued\r\n");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-fake.smtp\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (verb === "AUTH") {
          current.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8");
          socket.write("235 authenticated\r\n");
        } else if (verb === "MAIL") {
          current.from = line;
          socket.write("250 ok\r\n");
        } else if (verb === "RCPT") {
          current.to = line;
          socket.write("250 ok\r\n");
        } else if (verb === "DATA") {
          mode = "data";
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return new Promise<{ port: number; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, received, close: () => server.close() })),
  );
}

console.log("email codes");

await test("SMTP: the code is sent through the configured server, signed in, from the right sender", async () => {
  const smtp = await fakeSmtp();
  const env = {
    NODE_ENV: "production",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: "false",
    SMTP_USER: "studio@example.com",
    SMTP_PASS: "abcd efgh ijkl mnop",
  } as NodeJS.ProcessEnv;
  assert.equal(emailConfigured(env), true);
  await sendEmailCode("tari@example.com", "604397", "sign-in", env);
  smtp.close();
  assert.equal(smtp.received.length, 1);
  const [mail] = smtp.received;
  assert.match(mail!.to, /tari@example\.com/);
  assert.match(mail!.from, /studio@example\.com/);
  assert.match(mail!.data, /604397/);
  assert.match(mail!.data, /Subject: Your Flyer Studio sign-in code/);
  assert.ok(mail!.auth.includes("abcdefghijklmnop"), "Gmail-style app password sent without its spaces");
});

await test("SMTP: a server that refuses fails the send (the sign-in form shows an error)", async () => {
  const env = { NODE_ENV: "production", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_SECURE: "false", SMTP_USER: "u@example.com", SMTP_PASS: "x" } as NodeJS.ProcessEnv;
  await assert.rejects(sendEmailCode("tari@example.com", "123456", "sign-in", env), /EMAIL_SEND_FAILED/);
});

await test("Resend is used when its key is set", async () => {
  const calls: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await sendEmailCode("tari@example.com", "111222", "sign-in", { NODE_ENV: "production", RESEND_API_KEY: "re_test", EMAIL_FROM: "Flyer Studio <login@flyers.test>" } as NodeJS.ProcessEnv);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.match(calls[0]!.body, /111222/);
});

await test("without any sender: printed in development, an error in production", async () => {
  assert.equal(emailConfigured({} as NodeJS.ProcessEnv), false);
  const log = console.log;
  let printed = "";
  console.log = (line: string) => void (printed += line);
  await sendEmailCode("tari@example.com", "999000", "sign-in", { NODE_ENV: "development" } as NodeJS.ProcessEnv);
  console.log = log;
  assert.match(printed, /999000/);
  await assert.rejects(sendEmailCode("tari@example.com", "999000", "sign-in", { NODE_ENV: "production" } as NodeJS.ProcessEnv), /EMAIL_NOT_CONFIGURED/);
});

console.log("phone numbers");

await test("numbers as people type them become E.164 (local 0… read as Zimbabwe)", () => {
  assert.equal(normalizePhone("0717 726 626"), "+263717726626");
  assert.equal(normalizePhone("+263 71 772 6626"), "+263717726626");
  assert.equal(normalizePhone("00263717726626"), "+263717726626");
  assert.equal(normalizePhone("hello"), null);
  assert.equal(studioNumber({ WHATSAPP_NUMBER: "0717726626" } as NodeJS.ProcessEnv), "+263717726626");
  assert.equal(formatPhone("+263717726626"), "+263 71 772 6626");
});

console.log("database outages");

const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });

await test("connection failures count as an outage, however they're wrapped; a bad query doesn't", () => {
  assert.ok(isDatabaseUnavailable(new Error("Failed query: select 1\nparams: ", { cause: refused })));
  assert.ok(isDatabaseUnavailable(new AggregateError([refused], "")));
  assert.ok(isDatabaseUnavailable(Object.assign(new Error("the database system is starting up"), { code: "57P03" })));
  assert.ok(isDatabaseUnavailable(Object.assign(new Error("connection failure"), { code: "08006" })));
  assert.ok(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect")));
  assert.ok(!isDatabaseUnavailable(Object.assign(new Error("syntax error at or near"), { code: "42601" })));
  assert.ok(!isDatabaseUnavailable(new Error("INVALID_OTP")));
});

await test("logged errors never carry Drizzle's query parameters (session tokens)", () => {
  const fields = describeError(new Error("Failed query: select * from session where token = $1\nparams: SECRET-TOKEN", { cause: refused }));
  assert.doesNotMatch(JSON.stringify(fields), /SECRET-TOKEN/);
  assert.deepEqual([fields.code, fields.cause], ["ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432"]);
});

await test("a session check with the database down: a recognisable outage, one quiet warning, no token", async () => {
  // Nothing listens on port 1: every connection is refused, like a stopped Postgres.
  process.env.DATABASE_URL = "postgres://flyer:flyer@127.0.0.1:1/flyer";
  const secret = "test-secret-for-the-outage-check-0123456789";
  process.env.BETTER_AUTH_SECRET = secret;
  const { createAuth } = await import("../src/index");
  const auth = createAuth();
  // A properly signed session cookie, so Better Auth really looks the token up.
  const token = "OUTAGETOKEN0123456789abcdefghijk";
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  const headers = new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` });
  const printed: { level: string; line: string }[] = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args: unknown[]) => void printed.push({ level: "warn", line: args.join(" ") });
  console.error = (...args: unknown[]) => void printed.push({ level: "error", line: args.join(" ") });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await auth.api.getSession({ headers }).then(
        () => assert.fail("the session check should fail while the database is down"),
        (error: unknown) => error,
      );
      assert.ok(isDatabaseUnavailable(failure), "the thrown error says the database is unreachable");
    }
  } finally {
    Object.assign(console, original);
    await closeDb();
  }
  assert.deepEqual(printed.map((entry) => entry.level), ["warn"], "one warning for both attempts, no console.error");
  assert.match(printed[0]!.line, /"event":"auth\.database_unreachable"/);
  assert.doesNotMatch(printed[0]!.line, new RegExp(token));
});

console.log(`\n${passed} passed`);
