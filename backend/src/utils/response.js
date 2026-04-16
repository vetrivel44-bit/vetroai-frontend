function successResponse(res, message, data = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function errorResponse(res, message, statusCode = 500, data = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    data,
  });
}

module.exports = {
  successResponse,
  errorResponse,
};
