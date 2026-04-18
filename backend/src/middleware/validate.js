module.exports = function validate(schema) {
  return (req, _res, next) => {
    try {
      req.validated = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      next();
    } catch (err) {
      next(err);
    }
  };
};
