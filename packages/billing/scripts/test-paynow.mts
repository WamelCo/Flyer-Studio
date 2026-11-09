/**
 * Paynow (Zimbabwe), offline: the hash against Paynow's own worked examples, then the
 * client against a mock Paynow — request fields and order, signed replies, tampering,
 * test-mode email, status outcomes and the poll-host guard. The database side (passes,
 * exactly-once credits, lapsing) is covered by `pnpm test:db`.
 *   pnpm test:paynow
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { initiateTransaction, outcomeOf, parseMessage, paynowConfig, paynowHash, pollTransaction, readStatus, verifyMessage } from "../src/paynow";
import { creditsForPass, effectivePlan, PLANS } from "../src/plans";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const DOC_KEY = "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977";

console.log("hash (Paynow's worked examples, developers.paynow.co.zw)");
await test("outbound: values run together, key appended, SHA512 upper-case", () => {
  const values = ["1201", "TEST REF", "99.99", "A test ticket transaction", "http://www.google.com/search?q=returnurl", "http://www.google.com/search?q=resulturl", "Message"];
  assert.equal(
    paynowHash(values, DOC_KEY),
    "2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689",
  );
});
const DOC_INBOUND =
  "status=Ok&browserurl=https%3a%2f%2fstaging.paynow.co.zw%2fPayment%2fConfirmPayment%2f9510&pollurl=https%3a%2f%2fstaging.paynow.co.zw%2fInterface%2fCheckPayment%2f%3fguid%3dc7ed41da-0159-46da-b428-69549f770413&paynowreference=9510&hash=750DD0B0DF374678707BB5AF915AF81C228B9058AD57BB7120569EC68BBB9C2EFC1B26C6375D2BC562AC909B3CD6B2AF1D42E1A5E479FFAC8F4FB3FDCE71DF4D";
await test("inbound: the documented message verifies; any change to it does not", () => {
  assert.equal(verifyMessage(parseMessage(DOC_INBOUND), DOC_KEY), true);
  assert.equal(verifyMessage(parseMessage(DOC_INBOUND.replace("9510&hash", "9511&hash")), DOC_KEY), false, "tampered value");
  assert.equal(verifyMessage(parseMessage(DOC_INBOUND), "another-key"), false, "wrong key");
  assert.equal(verifyMessage(parseMessage(DOC_INBOUND.replace(/&hash=.*$/, "")), DOC_KEY), false, "no hash");
});
await test("keys are matched case-insensitively (Paynow sends Status=Ok&BrowserUrl=…)", () => {
  const pairs = parseMessage("Status=Ok&BrowserUrl=x&Hash=y");
  assert.deepEqual(pairs.map(([k]) => k), ["status", "browserurl", "hash"]);
});

console.log("statuses");
await test("Paid, Awaiting Delivery and Delivered are paid; Cancelled/Failed/Disputed/Refunded fail; the rest wait", () => {
  for (const s of ["Paid", "Awaiting Delivery", "Delivered", "paid"]) assert.equal(outcomeOf(s), "paid", s);
  for (const s of ["Cancelled", "Failed", "Disputed", "Refunded"]) assert.equal(outcomeOf(s), "failed", s);
  for (const s of ["Created", "Sent", "", null]) assert.equal(outcomeOf(s), "pending", String(s));
});

console.log("plans");
await test("a pass grants its month or its year of credits; an ended pass reads as Free", () => {
  assert.equal(creditsForPass("pro", "month"), 2000);
  assert.equal(creditsForPass("max", "year"), 240000);
  assert.equal(PLANS.pro.price.month, 19.99);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(effectivePlan("pro", tomorrow), "pro");
  assert.equal(effectivePlan("pro", yesterday), "free");
  assert.equal(effectivePlan("max", null), "free");
});

// ── A mock Paynow ────────────────────────────────────────────────────────────
const KEY = "11111111-2222-3333-4444-555555555555";
type Handler = (path: string, body: string) => string;
let handler: Handler = () => "";
const seen: { path: string; body: string }[] = [];
const server = createServer(async (req: IncomingMessage, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  seen.push({ path: req.url ?? "", body });
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(handler(req.url ?? "", body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const config = paynowConfig({ PAYNOW_INTEGRATION_ID: "1201", PAYNOW_INTEGRATION_KEY: KEY, PAYNOW_BASE_URL: base } as NodeJS.ProcessEnv)!;
const signed = (pairs: [string, string][]) => new URLSearchParams([...pairs, ["hash", paynowHash(pairs.map(([, v]) => v), KEY)]]).toString();
const reset = (h: Handler) => {
  handler = h;
  seen.length = 0;
};
const payment = { reference: "0b8f2c4e-0000-4000-8000-000000000001", amount: 19.99, info: "Flyer Studio Pro — 1 month", returnUrl: "https://app.test/billing?payment=x", resultUrl: "https://app.test/api/webhooks/paynow", authEmail: "ada@example.com" };

console.log("initiate (mock Paynow)");
await test("posts the documented fields in order, signed; returns the payment page and poll URL", async () => {
  reset(() => signed([["status", "Ok"], ["browserurl", `${base}/pay/1`], ["pollurl", `${base}/poll/1`], ["paynowreference", "9510"]]));
  const result = await initiateTransaction(config, payment);
  assert.deepEqual(result, { ok: true, browserUrl: `${base}/pay/1`, pollUrl: `${base}/poll/1` });
  assert.equal(seen[0]!.path, "/interface/initiatetransaction");
  const sent = parseMessage(seen[0]!.body);
  assert.deepEqual(sent.map(([k]) => k), ["id", "reference", "amount", "additionalinfo", "returnurl", "resulturl", "authemail", "status", "hash"]);
  assert.equal(sent.find(([k]) => k === "amount")![1], "19.99");
  assert.equal(verifyMessage(sent, KEY), true, "our request carries a valid hash");
});
await test("a reply whose hash doesn't match is refused — never redirect to it", async () => {
  reset(() => "status=Ok&browserurl=https%3a%2f%2fevil.test%2fpay&pollurl=x&hash=DEADBEEF");
  const result = await initiateTransaction(config, payment);
  assert.equal(result.ok, false);
});
await test("an error reply surfaces Paynow's message", async () => {
  reset(() => "status=Error&error=Invalid+amount+field");
  assert.deepEqual(await initiateTransaction(config, payment), { ok: false, error: "Invalid amount field" });
});
await test("in test mode the merchant's email is sent instead of the customer's", async () => {
  reset(() => signed([["status", "Ok"], ["browserurl", "b"], ["pollurl", "p"]]));
  await initiateTransaction({ ...config, testAuthEmail: "merchant@shop.test" }, payment);
  assert.equal(parseMessage(seen[0]!.body).find(([k]) => k === "authemail")![1], "merchant@shop.test");
});

console.log("status (result URL and poll)");
await test("a signed status update reads as its outcome, reference and amount", () => {
  const body = signed([["reference", payment.reference], ["paynowreference", "123456"], ["amount", "19.99"], ["status", "Awaiting Delivery"], ["pollurl", `${base}/poll/1`]]);
  assert.deepEqual(readStatus(body, KEY), { ok: true, outcome: "paid", status: "Awaiting Delivery", reference: payment.reference, paynowReference: "123456", amount: 19.99 });
  assert.equal(readStatus(body.replace("19.99", "0.01"), KEY).ok, false, "an altered amount fails the signature");
});
await test("polling posts to the poll URL and verifies the reply", async () => {
  reset(() => signed([["reference", payment.reference], ["paynowreference", "123456"], ["amount", "19.99"], ["status", "Paid"], ["pollurl", `${base}/poll/1`]]));
  const result = await pollTransaction(config, `${base}/poll/1`);
  assert.equal(result.ok && result.outcome, "paid");
  assert.equal(seen[0]!.path, "/poll/1");
});
await test("only Paynow's hosts are ever polled (a stored poll URL can't send us elsewhere)", async () => {
  reset(() => "");
  const result = await pollTransaction(config, "https://169.254.169.254/latest/meta-data");
  assert.equal(result.ok, false);
  assert.equal(seen.length, 0, "no request made");
});
await test("without an integration ID and key, payments are simply not configured", () => {
  assert.equal(paynowConfig({} as NodeJS.ProcessEnv), null);
  assert.equal(paynowConfig({ PAYNOW_INTEGRATION_ID: "1" } as NodeJS.ProcessEnv), null);
});

server.close();
console.log(`\n${passed} passed`);
