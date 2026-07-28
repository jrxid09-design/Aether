const timestamp = () => {
  return new Date().toISOString();
};

module.exports = {
  info(message) {
    console.log(`[${timestamp()}] [INFO] ${message}`);
  },

  warn(message) {
    console.warn(`[${timestamp()}] [WARN] ${message}`);
  },

  error(message) {
    console.error(`[${timestamp()}] [ERROR] ${message}`);
  }
};