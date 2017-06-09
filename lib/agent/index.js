const assert = require('assert');
const http = require('http');
const urlParse = require('url').parse;
const Agent = require('./agent');

const httpsAgents = {};
const httpAgents = {};
const idleTimeout = 60000;
const freeSocketErrorListener = () => {
  const socket = this;
  socket.destroy();
  socket.emit('agentRemove');
  socket.removeListener('error', freeSocketErrorListener);
};
const preventThrowOutError = (socket) => {
  socket.removeListener('error', freeSocketErrorListener);
  socket.on('error', freeSocketErrorListener);
};

const parseProxy = (options) => {
  if (!options) {
    assert(options, 'argument options is required.');
  }
  let proxyUrl = options;
  if (typeof options !== 'string') {
    assert(options.proxyUrl && typeof options.proxyUrl === 'string', 'String options.proxyUrl is required.');
    proxyUrl = options.proxyUrl;
  }
  options = urlParse(proxyUrl);
  return {
    host: options.hostname,
    port: options.port || 80,
    auth: options.auth,
  };
};

const getCacheKey = (options) => {
  const auth = options.auth || '';
  return [options.type, options.hostname, options.port, auth].join(':');
};
const getAgent = (options, cache, type) => {
  let proxyOptions = parseProxy(options);
  proxyOptions.type = type;
  proxyOptions.headers = options.headers;
  const key = getCacheKey(options);
  let agent = cache[key];
  if (!agent) {
    proxyOptions.proxyAuth = options.auth;
    options = {
      proxy: proxyOptions,
      rejectUnauthorized: false,
    };
    agent = cache[key] = new Agent[type](options);
    agent.on('free', preventThrowOutError);
    const createSocket = agent.createSocket;
    agent.createSocket = function (opts, cb) {
      createSocket.call(this, opts, (socket) => {
        socket.setTimeout(idleTimeout, () => socket.destroy());
        cb(socket);
      });
    };
  }

  return agent;
};

const toBase64 = (buf) => {
  if (buf == null || buf instanceof Buffer) {
    return buf;
  }
  return new Buffer(`${buf}`).toString('base64');
};
const noop = () => {};
const connect = (options, cb) => {
  let proxyOptions = parseProxy(options);
  proxyOptions = {
    method: 'CONNECT',
    agent: false,
    path: `${options.host}:${options.port}`,
    host: proxyOptions.host,
    port: proxyOptions.port,
    headers: options.headers || {},
  };
  proxyOptions.headers.host = proxyOptions.path;
  if (proxyOptions.auth) {
    proxyOptions.headers['Proxy-Authorization'] = `Basic ${toBase64(options.auth)}`;
  }
  const req = http.request(proxyOptions);
  const timer = setTimeout(() => {
    req.emit('error', new Error('Timeout'));
    req.abort();
  }, 16000);
  req.on('connect', (res, socket) => {
    clearTimeout(timer);
    socket.on('error', noop);
    cb(socket);
    if (res.statusCode !== 200) {
      process.nextTick(() => {
        req.emit('error', new Error(`Tunneling socket could not be established, statusCode=${res.statusCode}`));
      });
    }
  }).end();
  return req;
};
/**
 * options:
 *  - host
 *  - port
 *  - proxyUrl
 *  - headers
 */
exports.getHttpsAgent = (options) => {
  return getAgent(options, httpsAgents, 'httpsOverHttp');
};
exports.getHttpAgent = (options) => {
  return getAgent(options, httpAgents, 'httpOverHttp');
};
exports.connect = connect;