const logger = require("../utils/logger");

const debugMiddleware = (req, res, next) => {
  const reqId = req.headers["x-request-id"] || req.body?.reqId || `req_${Date.now()}`;
  
  logger.info("Debug.request.incoming", {
    reqId,
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.method !== "GET" ? req.body : undefined
  });

  const oldWrite = res.write;
  const oldEnd = res.end;

  res.write = function (chunk, encoding, callback) {
    // Only log if it's not a heartbeat
    const chunkStr = chunk.toString();
    if (!chunkStr.includes(": ping")) {
      logger.debug("Debug.response.chunk", { reqId, length: chunk.length });
    }
    return oldWrite.apply(res, arguments);
  };

  res.end = function (chunk, encoding, callback) {
    logger.info("Debug.response.ended", { reqId });
    return oldEnd.apply(res, arguments);
  };

  next();
};

module.exports = debugMiddleware;
