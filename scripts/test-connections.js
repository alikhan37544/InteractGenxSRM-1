#!/usr/bin/env node

/**
 * Connection Validation Script
 * Tests connectivity to both OpenRouter and LM Studio
 */

const https = require("https");
const http = require("http");

function testOpenRouter(apiKey) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: "openrouter.ai",
      path: "/api/v1/models",
      method: "GET",
      headers: {
        "Authorization": apiKey ? `Bearer ${apiKey}` : undefined,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "GEO Command Center",
      },
    };

    const req = https.request(options, (res) => {
      const latency = Date.now() - startTime;
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({
            success: true,
            latency,
            status: res.statusCode,
            message: "OpenRouter API is accessible",
          });
        } else if (res.statusCode === 401) {
          resolve({
            success: false,
            latency,
            status: res.statusCode,
            message: "OpenRouter API key is invalid or missing",
          });
        } else {
          resolve({
            success: false,
            latency,
            status: res.statusCode,
            message: `OpenRouter returned status ${res.statusCode}`,
          });
        }
      });
    });

    req.on("error", (error) => {
      const latency = Date.now() - startTime;
      resolve({
        success: false,
        latency,
        message: `OpenRouter connection failed: ${error.message}`,
      });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      const latency = Date.now() - startTime;
      resolve({
        success: false,
        latency,
        message: "OpenRouter connection timeout (5s)",
      });
    });

    req.end();
  });
}

function testLMStudio() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: "localhost",
      port: 1234,
      path: "/v1/models",
      method: "GET",
      timeout: 3000,
    };

    const req = http.request(options, (res) => {
      const latency = Date.now() - startTime;
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({
            success: true,
            latency,
            status: res.statusCode,
            message: "LM Studio server is running",
          });
        } else {
          resolve({
            success: false,
            latency,
            status: res.statusCode,
            message: `LM Studio returned status ${res.statusCode}`,
          });
        }
      });
    });

    req.on("error", (error) => {
      const latency = Date.now() - startTime;
      if (error.code === "ECONNREFUSED") {
        resolve({
          success: false,
          latency,
          message:
            "LM Studio connection refused. Is the server running on port 1234?",
        });
      } else {
        resolve({
          success: false,
          latency,
          message: `LM Studio connection failed: ${error.message}`,
        });
      }
    });

    req.setTimeout(3000, () => {
      req.destroy();
      const latency = Date.now() - startTime;
      resolve({
        success: false,
        latency,
        message: "LM Studio connection timeout (3s)",
      });
    });

    req.end();
  });
}

async function main() {
  console.log("🔍 Testing AI Provider Connections...\n");

  const apiKey = process.env.OPENROUTER_API_KEY || "";

  // Test OpenRouter
  console.log("Testing OpenRouter API...");
  const openRouterResult = await testOpenRouter(apiKey);
  console.log(
    `  ${openRouterResult.success ? "✅" : "❌"} ${openRouterResult.message}`
  );
  console.log(`  Latency: ${openRouterResult.latency}ms`);
  if (openRouterResult.status) {
    console.log(`  Status: ${openRouterResult.status}`);
  }
  console.log();

  // Test LM Studio
  console.log("Testing LM Studio (localhost:1234)...");
  const lmStudioResult = await testLMStudio();
  console.log(
    `  ${lmStudioResult.success ? "✅" : "❌"} ${lmStudioResult.message}`
  );
  console.log(`  Latency: ${lmStudioResult.latency}ms`);
  if (lmStudioResult.status) {
    console.log(`  Status: ${lmStudioResult.status}`);
  }
  console.log();

  // Summary
  console.log("📊 Summary:");
  console.log(
    `  OpenRouter: ${openRouterResult.success ? "Available" : "Unavailable"}`
  );
  console.log(
    `  LM Studio: ${lmStudioResult.success ? "Available" : "Unavailable"}`
  );

  // Exit codes
  if (!openRouterResult.success && !lmStudioResult.success) {
    console.log("\n⚠️  No providers are available. Please configure at least one.");
    process.exit(1);
  } else if (!openRouterResult.success) {
    console.log("\n⚠️  OpenRouter is unavailable. Using LM Studio only.");
    process.exit(0);
  } else if (!lmStudioResult.success) {
    console.log("\n⚠️  LM Studio is unavailable. Using OpenRouter only.");
    process.exit(0);
  } else {
    console.log("\n✅ Both providers are available!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("❌ Script error:", error);
  process.exit(1);
});

