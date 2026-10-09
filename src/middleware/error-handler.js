function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    error: {
      code: error.code || "INTERNAL_SERVER_ERROR",
      message:
        statusCode >= 500 && !error.code
          ? "An unexpected server error occurred."
          : error.message,
    },
  };

  if (error.metaError) response.error.meta = error.metaError;
  if (error.metaFlowId) {
    response.error.metaFlowId = error.metaFlowId;
    if (error.code === "DATABASE_SAVE_FAILED") {
      response.error.message = `${error.message} Meta created Flow ${error.metaFlowId}, but it was not saved locally. Do not retry blindly because that could create a duplicate Meta Flow.`;
    }
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  return res.status(statusCode).json(response);
}

module.exports = { errorHandler };
