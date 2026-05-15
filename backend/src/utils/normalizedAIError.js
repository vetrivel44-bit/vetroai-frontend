class NormalizedAIError extends Error {
  constructor(type, message, provider, originalError = null) {
    super(message);
    this.type = type; // timeout, rate_limit, auth_error, provider_down, invalid_response, stream_interrupted, network_error
    this.provider = provider;
    this.originalError = originalError;
  }
}

module.exports = NormalizedAIError;
