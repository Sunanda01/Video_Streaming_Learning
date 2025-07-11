import aj from "@/lib/arcjet";
import { auth } from "@/lib/auth";
import {
  ArcjetDecision,
  shield,
  slidingWindow,
  validateEmail,
} from "@/lib/arcjet";
import { toNextJsHandler } from "better-auth/next-js";
import ip from "@arcjet/ip";
import { NextRequest } from "next/server";
const authHandler = toNextJsHandler(auth.handler);

//Email Validation
const emailValidation = aj.withRule(
  validateEmail({
    mode: "LIVE",
    block: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"],
  })
);

//Rate Limit
const rateLimit = aj.withRule(
  slidingWindow({
    mode: "LIVE",
    interval: "2m",
    max: 2,
    characteristics: ["fingerprint"],
  })
);

const shieldValidation = aj.withRule(
  shield({
    mode: "LIVE",
  })
);

const protectedAuth = async (
  req: NextRequest,
  body: any
): Promise<ArcjetDecision> => {
  const session = await auth.api.getSession({ headers: req.headers });
  let userId: string;
  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    userId = ip(req) || "127.0.0.1";
  }
  if (req.nextUrl.pathname.startsWith("/api/auth/sign-in")) {
    if (typeof body.email === "string") {
      return emailValidation.protect(req, { email: body.email });
    }
  }

  if (!req.nextUrl.pathname.startsWith("/api/auth/sign-out")) {
    return rateLimit.protect(req, { fingerprint: userId });
  }

  return shieldValidation.protect(req);
};

export const { GET } = authHandler;

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const decision = await protectedAuth(req, body);

    if (decision.isDenied()) {
      if (decision.reason.isEmail()) {
        return new Response("Email validation failed", { status: 400 });
      }
      if (decision.reason.isRateLimit()) {
        return new Response("Rate limit exceeded", { status: 429 });
      }
      if (decision.reason.isShield()) {
        return new Response("Shield validation failed", { status: 403 });
      }
    }
    const newReq = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(body),
    });

    return authHandler.POST(newReq);
  } catch (error) {
    console.error("POST handler error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
