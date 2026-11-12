module.exports = {
  '/api': {
    target: `http://127.0.0.1:${process.env.PORT || '9000'}`,
    secure: false,
  },
};