const httpProxy = require("http-proxy");
const urlParse = require("url").parse;

// XXX: this is temporary code, intended to be removed
module.exports = function (apiRouter, conf, logError, storage, auth, validators, statsdClient) {
  var proxy = httpProxy.createProxyServer({});
  proxy.on("proxyRes", function (proxyRes, req, res) {
    proxyRes.headers["access-control-allow-origin"] = "*";
  });
  apiRouter.all("/proxy",
    function (req, res) {
      var url = req.query.url;
      var parsed = urlParse(url);
      if (! parsed || ! parsed.host || parsed.protocol !== "https:") {
        logError("Invalid proxy URL");
        throw new Error("Invalid proxy URL: " + JSON.stringify(url) + " in " + JSON.stringify(parsed));
      }
      if (parsed.host.search(/\.firebaseio\.com$/) === -1) {
        throw new Error("Proxy URL to somewhere other than firebaseio.com: " + JSON.stringify(parsed.host));
      }
      // Simple way to avoid invalid things like auth through the proxy:
      var target = parsed.protocol + "//" + parsed.host + parsed.path;
      proxy.web(req, res, {target: target, ignorePath: true, changeOrigin: true});
    }
  );
};
