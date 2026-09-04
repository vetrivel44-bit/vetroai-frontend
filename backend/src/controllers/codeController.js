const https = require("https");
const logger = require("../utils/logger");

const COMPILER_MAP = {
  python: "cpython-3.12.7",
  javascript: "nodejs-20.17.0",
  typescript: "typescript-5.6.2",
  c: "gcc-13.2.0-c",
  cpp: "gcc-13.2.0",
  java: "openjdk-jdk-21+35",
  go: "go-1.23.2",
  rust: "rust-1.82.0",
  ruby: "ruby-3.3.11",
  php: "php-8.3.12",
  swift: "swift-6.0.1",
  bash: "bash",
  r: "r-4.4.1",
  csharp: "dotnetcore-8.0.402"
};

async function executeCode(req, res) {
  const { language, code, stdin } = req.body;

  if (!language || !code) {
    return res.status(400).json({ error: "Language and code are required fields." });
  }

  const compiler = COMPILER_MAP[language];
  if (!compiler) {
    return res.status(400).json({ error: `Language '${language}' is not supported.` });
  }

  const postData = JSON.stringify({
    compiler: compiler,
    code: code,
    stdin: stdin || ""
  });

  const options = {
    hostname: "wandbox.org",
    port: 443,
    path: "/api/compile.json",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    },
    timeout: 20000 // 20 second timeout
  };

  // Destroying the request on timeout also fires its "error" handler, so both
  // paths would answer the same request and the second send would throw
  // ERR_HTTP_HEADERS_SENT. Only the first outcome wins.
  let settled = false;
  const respond = (send) => {
    if (settled) return;
    settled = true;
    send();
  };

  const wandboxReq = https.request(options, (wandboxRes) => {
    let responseData = "";

    wandboxRes.on("data", (chunk) => {
      responseData += chunk;
    });

    wandboxRes.on("end", () => {
      try {
        if (wandboxRes.statusCode !== 200) {
          logger.error("Wandbox API error", { status: wandboxRes.statusCode, data: responseData });
          return respond(() => res.status(502).json({ error: `Compiler API responded with status ${wandboxRes.statusCode}` }));
        }

        const data = JSON.parse(responseData);

        // Extract messages and output
        const compileOut = data.compiler_message || "";
        const runOut     = data.program_output || data.program_message || "";
        // Wandbox omits "status" on success. parseInt gives NaN there, and NaN
        // survives ?? — it serialized to a null exit code instead of 0.
        const parsedExit = parseInt(data.status, 10);
        const exitCode   = Number.isNaN(parsedExit) ? 0 : parsedExit;

        return respond(() => res.json({
          compile: {
            output: compileOut
          },
          run: {
            output: runOut,
            code: exitCode
          }
        }));
      } catch (err) {
        logger.error("Failed to parse Wandbox response", { error: err.message, raw: responseData });
        return respond(() => res.status(502).json({ error: "Failed to parse compiler response." }));
      }
    });
  });

  wandboxReq.on("error", (err) => {
    logger.error("Wandbox request failed", { error: err.message });
    return respond(() => res.status(504).json({ error: "Compiler service timed out or was unreachable." }));
  });

  wandboxReq.on("timeout", () => {
    respond(() => res.status(504).json({ error: "Compiler execution timed out." }));
    wandboxReq.destroy();
  });

  wandboxReq.write(postData);
  wandboxReq.end();
}

module.exports = { executeCode };
