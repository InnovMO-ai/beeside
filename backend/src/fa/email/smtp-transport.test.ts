import { SmtpEmailTransport, renderBodies, smtpConfigFromEnv } from "./smtp-transport";
import { fa4EmailTransportFromEnv } from "../../index";
import { LogEmailTransport } from "./email-adapter";

const cfg = { host: "smtp.example", port: 587, secure: false, user: "contact@beeside.you", password: "s3cr3t-value", from: "contact@beeside.you", fromName: "beeside", replyTo: "contact@beeside.you" };
const msg = { template: "fa4_result_link", to: "lucia@nortica.example", locale: "es" as const, subject: "Asunto\r\nBcc: x@y.z", body: "Hola <b>", ctaLabel: "Ver", ctaUrl: "https://fa.test/fa4#r=abc", projectId: null };

describe("SmtpEmailTransport", () => {
  it("sends from / replies to contact@beeside.you and reports success only on provider acceptance", async () => {
    const sendMail = jest.fn().mockResolvedValue({ accepted: ["lucia@nortica.example"], rejected: [], messageId: "<m1@beeside.you>" });
    const t = new SmtpEmailTransport(cfg, { sendMail } as never);
    const res = await t.send(msg, { idempotencyKey: "d-1" });
    expect(res.providerReference).toBe("<m1@beeside.you>");
    const sent = sendMail.mock.calls[0]![0];
    expect(sent.from).toEqual({ name: "beeside", address: "contact@beeside.you" });
    expect(sent.replyTo).toBe("contact@beeside.you");
    expect(sent.subject).not.toMatch(/[\r\n]/);
    expect(sent.headers["X-Beeside-Delivery"]).toBe("d-1");
    expect(sent.html).toContain("&lt;b&gt;");                              // body is escaped
  });
  it("a contact message keeps the writer as Reply-To", async () => {
    const sendMail = jest.fn().mockResolvedValue({ accepted: ["contact@beeside.you"], rejected: [] });
    await new SmtpEmailTransport(cfg, { sendMail } as never).send({ ...msg, to: "contact@beeside.you", replyTo: "lucia@nortica.example", ctaLabel: "", ctaUrl: "" });
    expect(sendMail.mock.calls[0]![0].replyTo).toBe("lucia@nortica.example");
    expect(renderBodies({ ...msg, ctaLabel: "", ctaUrl: "" }).html).not.toContain("<a ");
  });
  it.each([
    ["rejected recipient", { accepted: [], rejected: ["a@b.c"] }],
    ["nothing accepted", { accepted: [], rejected: [] }],
  ])("%s → throws (never a false success)", async (_n, info) => {
    const t = new SmtpEmailTransport(cfg, { sendMail: jest.fn().mockResolvedValue(info) } as never);
    await expect(t.send(msg)).rejects.toThrow();
  });
  it("a connection / auth error propagates and never contains the password", async () => {
    const t = new SmtpEmailTransport(cfg, { sendMail: jest.fn().mockRejectedValue(new Error("535 auth failed")) } as never);
    await expect(t.send(msg)).rejects.toThrow("535 auth failed");
  });
});

describe("SMTP configuration", () => {
  it("names the missing variables, never their values", () => {
    const r = smtpConfigFromEnv({ SMTP_USER: "contact@beeside.you" });
    expect(r.config).toBeNull(); expect(r.missing).toEqual(["SMTP_HOST", "SMTP_PASSWORD", "MAIL_FROM"]);
  });
  it("log is the staging default; production requires smtp and refuses log", () => {
    expect(fa4EmailTransportFromEnv({}, true)).toBeInstanceOf(LogEmailTransport);
    expect(() => fa4EmailTransportFromEnv({ NODE_ENV: "production", FA4_EMAIL_TRANSPORT: "log" }, false)).toThrow(/refused in production/);
    expect(() => fa4EmailTransportFromEnv({ NODE_ENV: "production" }, false)).toThrow(/SMTP_HOST/);
    expect(() => fa4EmailTransportFromEnv({ FA4_EMAIL_TRANSPORT: "ses" }, true)).toThrow(/log or smtp/);
  });
  it("smtp builds a transport with contact@beeside.you as sender and Reply-To by default", () => {
    const t = fa4EmailTransportFromEnv({ FA4_EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example", SMTP_PASSWORD: "x" }, true);
    expect(t.name).toBe("smtp");
  });
});
